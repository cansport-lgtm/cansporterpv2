-- Store Pass: who links passes to dispatches.
--
-- The store keeper (store_pass_officer) only MAKES store passes: plan number,
-- items, hand-over person, photo. Linking a pass to the dispatch sheet (the
-- system dispatch, DC) is the dispatch operator's job, done from the Domestic
-- Dispatch page. So:
--   * store_pass_link_dispatches is allowed for the "linker" roles
--     (super_admin, store_pass_manager, gate_pass_manager, dispatch_operator,
--     sales_order_manager) and no longer for store_pass_officer;
--   * store_pass_save never links (no automatic link by DC number, no
--     dispatch_ids) — the keeper's save would otherwise fail the linker check
--     and the link is the operator's decision anyway;
--   * issuing a pass with no link tells the dispatch operators;
--   * three dispatch-side helpers for the operator's dialog: candidates for a
--     dispatch, attach a pass, detach the pass.
-- Functions keep their signatures; the old auto-link behaviour is removed.

-- 1. Who may link ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_pass_can_link()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.store_pass_has_any_role(
    ARRAY['super_admin','store_pass_manager','gate_pass_manager','dispatch_operator','sales_order_manager']);
$$;

CREATE OR REPLACE FUNCTION public.store_pass_link_dispatches(p_id uuid, p_dispatch_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.store_passes%ROWTYPE;
  d record;
  v_other text;
  v_before text;
  v_after text;
BEGIN
  IF NOT public.store_pass_can_link() THEN
    RAISE EXCEPTION 'Only a dispatch operator (or a store pass / gate pass manager) can link store passes to dispatches.';
  END IF;
  SELECT * INTO s FROM public.store_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store pass not found.';
  END IF;
  IF s.status = 'cancelled' THEN
    RAISE EXCEPTION 'Store pass % is cancelled and cannot be linked.', s.pass_number;
  END IF;

  SELECT string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number) INTO v_before
    FROM public.store_pass_dispatches spd JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
   WHERE spd.store_pass_id = p_id;

  PERFORM public.store_pass_clear_links(p_id);

  FOR d IN
    SELECT sd.* FROM public.sales_dispatches sd
     WHERE sd.id = ANY (COALESCE(p_dispatch_ids, ARRAY[]::uuid[]))
     ORDER BY sd.dispatch_number
  LOOP
    IF d.sales_segment::text <> 'domestic' THEN
      RAISE EXCEPTION 'Dispatch % is not a domestic dispatch.', d.dispatch_number;
    END IF;
    SELECT sp.pass_number INTO v_other
      FROM public.store_pass_dispatches spd
      JOIN public.store_passes sp ON sp.id = spd.store_pass_id
     WHERE spd.dispatch_id = d.id AND sp.id <> p_id AND sp.status <> 'cancelled'
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'Dispatch % is already on store pass %.', d.dispatch_number, v_other;
    END IF;
    INSERT INTO public.store_pass_dispatches (store_pass_id, dispatch_id) VALUES (p_id, d.id);
  END LOOP;

  SELECT string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number) INTO v_after
    FROM public.store_pass_dispatches spd JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
   WHERE spd.store_pass_id = p_id;

  -- The customers of the linked dispatches, else the plan number, for the register.
  UPDATE public.store_passes
     SET party_name = COALESCE(
           (SELECT string_agg(DISTINCT cu.name, '; ' ORDER BY cu.name)
              FROM public.store_pass_dispatches spd
              JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
              JOIN public.sales_orders so
                ON so.id = sd.order_id
                OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)
              JOIN public.customers cu ON cu.id = so.customer_id
             WHERE spd.store_pass_id = p_id),
           'Plan ' || COALESCE(dispatch_plan_no, '—')),
         updated_at = now()
   WHERE id = p_id;

  IF v_before IS DISTINCT FROM v_after THEN
    PERFORM public.store_pass_log(p_id, 'linked',
      CASE WHEN v_after IS NULL THEN 'Unlinked from ' || v_before ELSE 'Linked to ' || v_after END,
      jsonb_build_object('before', v_before, 'after', v_after));
  END IF;
  RETURN (SELECT count(*) FROM public.store_pass_dispatches WHERE store_pass_id = p_id);
END;
$$;

-- 2. Saving never links ------------------------------------------------------

-- p_data: { pass_date, dispatch_plan_no (required), received_by_name, photo_path,
--   remarks, lines: [{description, product_id, quantity, packages, remarks}] }
-- A dispatch_ids key, if an old client still sends one, is ignored.
CREATE OR REPLACE FUNCTION public.store_pass_save(p_id uuid, p_data jsonb, p_issue boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_old public.store_passes%ROWTYPE;
  v_id uuid := p_id;
  v_plan text := NULLIF(upper(btrim(p_data->>'dispatch_plan_no')), '');
  v_n integer;
BEGIN
  IF NOT public.store_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to make store passes.';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.store_passes WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Store pass not found.';
    END IF;
    IF v_old.status <> 'draft' THEN
      RAISE EXCEPTION 'Store pass % is % and can no longer be edited.', v_old.pass_number, v_old.status;
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid AND NOT public.store_pass_can('manage') THEN
      RAISE EXCEPTION 'Only the person who made this draft or a store pass manager can edit it.';
    END IF;
  ELSE
    -- A placeholder number until every check below has passed, so a failed
    -- save never uses up an SP number and the series stays without gaps.
    INSERT INTO public.store_passes (pass_number, party_name, created_by)
    VALUES ('NEW-' || gen_random_uuid()::text, '—', v_uid)
    RETURNING id INTO v_id;
  END IF;

  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'Enter the dispatch plan number.';
  END IF;

  v_n := public.store_pass_build(v_id, p_data->'lines');

  UPDATE public.store_passes
     SET pass_date = COALESCE(NULLIF(p_data->>'pass_date', '')::date, pass_date),
         dispatch_plan_no = v_plan,
         -- Keep the customers' names once the operator has linked the pass.
         party_name = CASE WHEN EXISTS (SELECT 1 FROM public.store_pass_dispatches WHERE store_pass_id = v_id)
                           THEN party_name ELSE 'Plan ' || v_plan END,
         received_by_name = NULLIF(btrim(p_data->>'received_by_name'), ''),
         photo_path = NULLIF(btrim(p_data->>'photo_path'), ''),
         remarks = NULLIF(btrim(p_data->>'remarks'), ''),
         vehicle_number = NULL, driver_name = NULL, driver_contact = NULL, store_location = NULL,
         pass_number = CASE WHEN p_id IS NULL
                            THEN 'SP-' || lpad(nextval('public.store_pass_number_seq')::text, 6, '0')
                            ELSE pass_number END,
         updated_at = now()
   WHERE id = v_id;

  PERFORM public.store_pass_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END,
    'Plan ' || v_plan || ' · ' || v_n || ' item(s) · '
      || (SELECT sum(quantity) || ' dz · ' || COALESCE(sum(packages), 0) || ' ctn' FROM public.store_pass_items WHERE store_pass_id = v_id));

  IF p_issue THEN
    PERFORM public.store_pass_issue(v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- 3. Issue: tell the dispatch operators when the pass still needs linking ------

CREATE OR REPLACE FUNCTION public.store_pass_issue(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  s public.store_passes%ROWTYPE;
  v_summary text;
BEGIN
  IF NOT public.store_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to issue store passes.';
  END IF;
  SELECT * INTO s FROM public.store_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store pass not found.';
  END IF;
  IF s.status <> 'draft' THEN
    RAISE EXCEPTION 'Store pass % is already %.', s.pass_number, s.status;
  END IF;
  IF s.created_by IS DISTINCT FROM v_uid AND NOT public.store_pass_can('manage') THEN
    RAISE EXCEPTION 'Only the person who made this draft or a store pass manager can issue it.';
  END IF;
  IF NULLIF(btrim(s.received_by_name), '') IS NULL THEN
    RAISE EXCEPTION 'Write who the goods were handed over to.';
  END IF;
  IF NULLIF(btrim(s.photo_path), '') IS NULL THEN
    RAISE EXCEPTION 'Take the photo of the stock at the loading dock.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.store_pass_items WHERE store_pass_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one item.';
  END IF;

  UPDATE public.store_passes
     SET status = 'issued', issued_by = v_uid, issued_at = now(), updated_at = now()
   WHERE id = p_id;

  SELECT sum(quantity) || ' dz · ' || COALESCE(sum(packages), 0) || ' ctn' INTO v_summary
    FROM public.store_pass_items WHERE store_pass_id = p_id;
  PERFORM public.store_pass_log(p_id, 'issued', v_summary || ' handed over to ' || s.received_by_name);

  -- Not linked yet: the dispatch operators link it from the Domestic Dispatch page.
  IF NOT EXISTS (SELECT 1 FROM public.store_pass_dispatches WHERE store_pass_id = p_id) THEN
    PERFORM public.notify_role(
      ARRAY['dispatch_operator','sales_order_manager']::app_role[],
      'Store pass ' || s.pass_number || ' to link',
      'Plan ' || COALESCE(s.dispatch_plan_no, '—') || ' · ' || v_summary
        || ' handed over to ' || s.received_by_name || '. Link it to its dispatch (DC) on the Domestic Dispatch page.',
      'info', 'store_pass', '/domestic/dispatch', 'store_pass', p_id, v_uid, v_uid);
  END IF;
  RETURN 'issued';
END;
$$;

-- 4. The operator's side: by dispatch ----------------------------------------

-- Store passes a dispatch could be linked to: every live pass that has no link
-- yet, plus this dispatch's own pass, plus recent linked ones (to move a
-- dispatch over). plan_matches: the pass's plan number is this dispatch's
-- number (the keeper wrote "DC-00412"), shown first.
CREATE OR REPLACE FUNCTION public.store_pass_link_candidates(p_dispatch_id uuid)
RETURNS TABLE (
  store_pass_id uuid, pass_number text, status text, pass_date date, dispatch_plan_no text,
  received_by_name text, issued_at timestamptz, created_by_name text,
  quantity numeric, packages numeric, item_count integer,
  linked_count integer, linked_dispatches text, is_current boolean, plan_matches boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH links AS (
    SELECT spd.store_pass_id,
           count(*)::integer AS linked_count,
           string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number) AS linked_dispatches,
           bool_or(spd.dispatch_id = p_dispatch_id) AS is_current
      FROM public.store_pass_dispatches spd
      JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
     GROUP BY spd.store_pass_id
  ), items AS (
    SELECT store_pass_id, sum(quantity) AS quantity, COALESCE(sum(packages), 0) AS packages, count(*)::integer AS item_count
      FROM public.store_pass_items GROUP BY store_pass_id
  )
  SELECT sp.id, sp.pass_number, sp.status, sp.pass_date, sp.dispatch_plan_no,
         sp.received_by_name, sp.issued_at, au.full_name,
         COALESCE(i.quantity, 0), COALESCE(i.packages, 0), COALESCE(i.item_count, 0),
         COALESCE(l.linked_count, 0), l.linked_dispatches, COALESCE(l.is_current, false),
         (public.store_pass_match_dispatch(sp.dispatch_plan_no) = p_dispatch_id)
    FROM public.store_passes sp
    LEFT JOIN links l ON l.store_pass_id = sp.id
    LEFT JOIN items i ON i.store_pass_id = sp.id
    LEFT JOIN public.app_users au ON au.id = sp.created_by
   WHERE sp.status <> 'cancelled'
     AND (l.store_pass_id IS NULL OR l.is_current OR sp.pass_date >= CURRENT_DATE - 7)
   ORDER BY COALESCE(l.is_current, false) DESC,
            (public.store_pass_match_dispatch(sp.dispatch_plan_no) = p_dispatch_id) DESC NULLS LAST,
            (l.store_pass_id IS NULL) DESC,
            sp.pass_date DESC, sp.pass_number DESC;
$$;

-- Put a dispatch on a store pass (keeps the pass's other links). Returns the
-- pass's link count.
CREATE OR REPLACE FUNCTION public.store_pass_attach_dispatch(p_store_pass_id uuid, p_dispatch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sales_dispatches WHERE id = p_dispatch_id) THEN
    RAISE EXCEPTION 'Dispatch not found.';
  END IF;
  SELECT array_agg(dispatch_id) INTO v_ids
    FROM public.store_pass_dispatches WHERE store_pass_id = p_store_pass_id AND dispatch_id <> p_dispatch_id;
  RETURN public.store_pass_link_dispatches(p_store_pass_id, COALESCE(v_ids, ARRAY[]::uuid[]) || p_dispatch_id);
END;
$$;

-- Take a dispatch off its live store pass. Returns the pass's remaining link
-- count, or NULL when the dispatch was on no pass.
CREATE OR REPLACE FUNCTION public.store_pass_detach_dispatch(p_dispatch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_sp uuid;
  v_ids uuid[];
BEGIN
  SELECT sp.id INTO v_sp
    FROM public.store_pass_dispatches spd JOIN public.store_passes sp ON sp.id = spd.store_pass_id
   WHERE spd.dispatch_id = p_dispatch_id AND sp.status <> 'cancelled'
   ORDER BY sp.created_at DESC LIMIT 1;
  IF v_sp IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT array_agg(dispatch_id) INTO v_ids
    FROM public.store_pass_dispatches WHERE store_pass_id = v_sp AND dispatch_id <> p_dispatch_id;
  RETURN public.store_pass_link_dispatches(v_sp, COALESCE(v_ids, ARRAY[]::uuid[]));
END;
$$;

-- 5. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.store_pass_link_candidates(uuid),
  public.store_pass_attach_dispatch(uuid, uuid),
  public.store_pass_detach_dispatch(uuid)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.store_pass_can_link() FROM PUBLIC, anon, authenticated;
