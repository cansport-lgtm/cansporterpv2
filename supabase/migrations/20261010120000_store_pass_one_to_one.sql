-- Store pass ↔ dispatch ↔ gate pass: one to one, corrections by super admin.
--
--   store pass (SP)  →  one dispatch sheet (DC)  →  one sales gate pass (GP)
--
-- * A store pass links to ONE dispatch; a dispatch is on one live store pass
--   (already the rule). The dispatch operator links an unlinked pass once;
--   changing or removing a link is a correction and only a super admin may do
--   it.
-- * A sales gate pass covers ONE dispatch; a dispatch is on one live gate pass
--   (already the rule). Changing the dispatch on a saved sales gate pass is a
--   correction and only a super admin may do it (the pass can still be
--   cancelled as before).
-- Signatures unchanged.

-- 1. Store pass: one dispatch, changes by super admin ---------------------------

CREATE OR REPLACE FUNCTION public.store_pass_link_dispatches(p_id uuid, p_dispatch_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.store_passes%ROWTYPE;
  d record;
  v_ids uuid[];
  v_other text;
  v_before text;
  v_before_id uuid;
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

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(COALESCE(p_dispatch_ids, ARRAY[]::uuid[])) x;
  v_ids := COALESCE(v_ids, ARRAY[]::uuid[]);
  IF cardinality(v_ids) > 1 THEN
    RAISE EXCEPTION 'A store pass links to one dispatch (DC). Make one store pass per dispatch.';
  END IF;

  SELECT sd.dispatch_number, sd.id INTO v_before, v_before_id
    FROM public.store_pass_dispatches spd JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
   WHERE spd.store_pass_id = p_id
   LIMIT 1;

  -- Already linked and asked for something else: a correction, super admin only.
  IF v_before_id IS NOT NULL AND (cardinality(v_ids) = 0 OR v_ids[1] <> v_before_id)
     AND NOT public.store_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Store pass % is already linked to %. Only a super admin can change or remove a link.', s.pass_number, v_before;
  END IF;

  PERFORM public.store_pass_clear_links(p_id);

  FOR d IN
    SELECT sd.* FROM public.sales_dispatches sd
     WHERE sd.id = ANY (v_ids)
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
  IF cardinality(v_ids) = 1 AND NOT EXISTS (SELECT 1 FROM public.store_pass_dispatches WHERE store_pass_id = p_id) THEN
    RAISE EXCEPTION 'Dispatch not found.';
  END IF;

  SELECT string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number) INTO v_after
    FROM public.store_pass_dispatches spd JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
   WHERE spd.store_pass_id = p_id;

  -- The customers of the linked dispatch, else the plan number, for the register.
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
      CASE WHEN v_after IS NULL THEN 'Unlinked from ' || v_before
           WHEN v_before IS NULL THEN 'Linked to ' || v_after
           ELSE 'Link corrected: ' || v_before || ' → ' || v_after END,
      jsonb_build_object('before', v_before, 'after', v_after,
                         'correction', v_before IS NOT NULL));
  END IF;
  RETURN (SELECT count(*) FROM public.store_pass_dispatches WHERE store_pass_id = p_id);
END;
$$;

-- Put a dispatch on a store pass. The pass's only link: a pass already linked
-- elsewhere is a correction (super admin, see above).
CREATE OR REPLACE FUNCTION public.store_pass_attach_dispatch(p_store_pass_id uuid, p_dispatch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.sales_dispatches WHERE id = p_dispatch_id) THEN
    RAISE EXCEPTION 'Dispatch not found.';
  END IF;
  RETURN public.store_pass_link_dispatches(p_store_pass_id, ARRAY[p_dispatch_id]);
END;
$$;

-- 2. Sales gate pass: one dispatch, changes by super admin ----------------------

CREATE OR REPLACE FUNCTION public.gate_pass_build_sales(p_id uuid, p_dispatch_ids uuid[])
RETURNS TABLE (party_name text, party_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d record;
  v_ids uuid[];
  v_saved uuid;
  v_saved_no text;
  v_other text;
  v_bad text;
  v_line integer := 0;
  v_n integer;
BEGIN
  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(COALESCE(p_dispatch_ids, ARRAY[]::uuid[])) x;
  IF v_ids IS NULL OR cardinality(v_ids) = 0 THEN
    RAISE EXCEPTION 'Select the dispatch for this vehicle.';
  END IF;
  IF cardinality(v_ids) > 1 THEN
    RAISE EXCEPTION 'A sales gate pass covers one dispatch (DC). Make one gate pass per dispatch.';
  END IF;

  -- The dispatch already saved on this pass: changing it is a correction.
  SELECT gd.dispatch_id, sd.dispatch_number INTO v_saved, v_saved_no
    FROM public.gate_pass_dispatches gd JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
   WHERE gd.gate_pass_id = p_id
   LIMIT 1;
  IF v_saved IS NOT NULL AND v_saved <> v_ids[1]
     AND NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'This gate pass is for dispatch %. Only a super admin can change the dispatch on a saved gate pass; otherwise cancel it and make a new one.', v_saved_no;
  END IF;

  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  DELETE FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id;

  FOR d IN
    SELECT sd.* FROM public.sales_dispatches sd
     WHERE sd.id = ANY (v_ids)
     ORDER BY sd.dispatch_number
       FOR UPDATE
  LOOP
    IF d.delivery_status IN ('delivered','returned','acknowledged') THEN
      RAISE EXCEPTION 'Dispatch % is already %.', d.dispatch_number, d.delivery_status;
    END IF;

    SELECT g.pass_number INTO v_other
      FROM public.gate_pass_dispatches gd
      JOIN public.gate_passes g ON g.id = gd.gate_pass_id
     WHERE gd.dispatch_id = d.id AND g.id <> p_id
       AND g.status NOT IN ('cancelled','rejected')
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'Dispatch % is already on gate pass %.', d.dispatch_number, v_other;
    END IF;

    SELECT string_agg(so.order_number || ' (' || so.status || ')', ', ') INTO v_bad
      FROM public.sales_orders so
     WHERE (so.id = d.order_id
            OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = d.id))
       AND so.status IN ('draft','pending','cancelled');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Dispatch % has sales orders that are not approved: %.', d.dispatch_number, v_bad;
    END IF;

    INSERT INTO public.gate_pass_dispatches (gate_pass_id, dispatch_id) VALUES (p_id, d.id);

    INSERT INTO public.gate_pass_items
      (gate_pass_id, line_no, product_id, dispatch_id, dispatch_item_id, description, uom,
       quantity, packages, count_basis)
    SELECT p_id, v_line + row_number() OVER (ORDER BY p.code, di.created_at, di.id),
           oi.product_id, d.id, di.id,
           COALESCE(p.code || ' · ' || p.name, 'Item') || COALESCE(' · ' || NULLIF(di.packing_type, ''), ''),
           'dz', di.quantity_dozens, di.packages,
           CASE WHEN COALESCE(di.packages, 0) > 0 THEN 'packages' ELSE 'quantity' END
      FROM public.sales_dispatch_items di
      JOIN public.sales_order_items oi ON oi.id = di.order_item_id
      LEFT JOIN public.products p ON p.id = oi.product_id
     WHERE di.dispatch_id = d.id AND di.quantity_dozens > 0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'Dispatch % has no items.', d.dispatch_number;
    END IF;
    v_line := v_line + v_n;
  END LOOP;

  IF (SELECT count(*) FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'The selected dispatch no longer exists.';
  END IF;

  IF v_saved IS NOT NULL AND v_saved <> v_ids[1] THEN
    PERFORM public.gate_pass_log(p_id, 'dispatch_changed',
      'Dispatch corrected: ' || v_saved_no || ' → ' || (SELECT dispatch_number FROM public.sales_dispatches WHERE id = v_ids[1]),
      jsonb_build_object('before', v_saved_no, 'after', (SELECT dispatch_number FROM public.sales_dispatches WHERE id = v_ids[1])));
  END IF;

  RETURN QUERY
  WITH c AS (
    SELECT DISTINCT cu.id, cu.name
      FROM public.gate_pass_dispatches gd
      JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
      JOIN public.sales_orders so
        ON so.id = sd.order_id
        OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)
      JOIN public.customers cu ON cu.id = so.customer_id
     WHERE gd.gate_pass_id = p_id
  )
  SELECT COALESCE(string_agg(c.name, '; ' ORDER BY c.name), 'Customer'),
         CASE WHEN count(*) = 1 THEN min(c.id::text)::uuid END
    FROM c;
END;
$$;
