-- ============================================================================
-- Store Pass — simplified pass: dispatch plan no., free-text items, hand-over
-- person and a photo of the stock at the loading dock
-- ----------------------------------------------------------------------------
-- The store keeper does not know the vehicle or the driver and does not pick
-- system dispatches. A store pass now records:
--
--   * dispatch_plan_no   the dispatch plan number written on the paper plan
--                        (free text; when it equals a domestic dispatch number,
--                        e.g. "DC-00412", the pass is linked to it automatically)
--   * lines              what the store handed over, typed by the keeper:
--                        description (free text), optional product, dozens,
--                        cartons, remark
--   * received_by_name   the person the goods were handed over to
--   * photo_path         a photo of the stock at the loading dock (required
--                        to issue)
--
-- Vehicle, driver and the dispatch snapshot are gone. The link between a store
-- pass and the system dispatches (store_pass_dispatches) stays, but is optional
-- and can be set later by the office (store_pass_link_dispatches) — it is what
-- the Dispatch Tracking page, the Gate Check notice and the daily store ↔ gate
-- reconciliation compare on. An issued pass that is not linked shows in the
-- reconciliation as SP_UNLINKED until it is.
--
-- Figures per dispatch: a pass linked to exactly one dispatch gives that
-- dispatch its totals; a pass linked to several dispatches cannot be split, so
-- those dispatches show the pass number without figures (sp_dispatch_count).
--
-- Rollback: supabase/rollbacks/20261009120000_store_pass_simplify_down.sql
-- ============================================================================

-- 1. Schema ------------------------------------------------------------------

ALTER TABLE public.store_passes ADD COLUMN IF NOT EXISTS dispatch_plan_no text;
CREATE INDEX IF NOT EXISTS store_passes_plan_idx ON public.store_passes (dispatch_plan_no);

ALTER TABLE public.store_pass_items ALTER COLUMN dispatch_id DROP NOT NULL;
ALTER TABLE public.store_pass_items ALTER COLUMN dispatch_quantity DROP NOT NULL;

-- 2. Views -------------------------------------------------------------------

-- Columns change (vehicle → plan number), so the view is recreated.
DROP VIEW IF EXISTS public.v_store_gate_tracking;
CREATE VIEW public.v_store_gate_tracking AS
WITH dc AS (
  SELECT sd.id AS dispatch_id,
         sd.dispatch_number,
         sd.dispatch_date,
         sd.created_at AS dispatch_created_at,
         sd.delivery_status,
         sd.vehicle_number AS dc_vehicle,
         sd.actual_delivery_date,
         sd.acknowledgement_date,
         (SELECT string_agg(DISTINCT cu.name, '; ' ORDER BY cu.name)
            FROM public.sales_orders so
            JOIN public.customers cu ON cu.id = so.customer_id
           WHERE so.id = sd.order_id
              OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)) AS customer_name,
         (SELECT string_agg(DISTINCT so.order_number, ', ' ORDER BY so.order_number)
            FROM public.sales_orders so
           WHERE so.id = sd.order_id
              OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)) AS order_numbers,
         COALESCE((SELECT sum(di.quantity_dozens) FROM public.sales_dispatch_items di WHERE di.dispatch_id = sd.id), 0) AS dc_quantity,
         COALESCE((SELECT sum(di.packages) FROM public.sales_dispatch_items di WHERE di.dispatch_id = sd.id), 0) AS dc_packages
    FROM public.sales_dispatches sd
   WHERE sd.sales_segment = 'domestic'
)
SELECT dc.*,
       sp.id AS store_pass_id, sp.pass_number AS sp_number, sp.status AS sp_status,
       sp.issued_at AS sp_issued_at, sp.dispatch_plan_no AS sp_dispatch_plan_no, sp.received_by_name AS sp_received_by,
       sp.created_at AS sp_created_at,
       spl.n AS sp_dispatch_count,
       -- Figures only when the pass covers this one dispatch; a pass over several cannot be split.
       CASE WHEN spl.n = 1 THEN spi.sp_quantity END AS sp_quantity,
       CASE WHEN spl.n = 1 THEN spi.sp_packages END AS sp_packages,
       gp.id AS gate_pass_id, gp.pass_number AS gp_number, gp.status AS gp_status,
       gp.created_at AS gp_created_at, gp.held_at AS gp_held_at, gp.gate_out_at,
       gp.vehicle_number AS gp_vehicle, gp.gate_vehicle_number,
       gpi.gp_quantity, gpi.gp_packages, gpi.gp_counted_packages, gpi.gp_counted_quantity,
       CASE
         WHEN dc.delivery_status IN ('delivered','acknowledged') THEN 'delivered'
         WHEN dc.delivery_status = 'returned' THEN 'returned'
         WHEN gp.gate_out_at IS NOT NULL OR dc.delivery_status = 'in_transit' THEN 'out'
         WHEN gp.status = 'held' THEN 'held'
         WHEN gp.id IS NOT NULL THEN 'on_gate_pass'
         WHEN sp.status = 'issued' THEN 'issued'
         WHEN sp.status = 'draft' THEN 'draft'
         ELSE 'no_store_pass'
       END AS stage
  FROM dc
  LEFT JOIN public.v_dispatch_store_pass vsp ON vsp.dispatch_id = dc.dispatch_id
  LEFT JOIN public.store_passes sp ON sp.id = vsp.store_pass_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS n FROM public.store_pass_dispatches d WHERE d.store_pass_id = sp.id
  ) spl ON true
  LEFT JOIN LATERAL (
    SELECT sum(i.quantity) AS sp_quantity, sum(i.packages) AS sp_packages
      FROM public.store_pass_items i
     WHERE i.store_pass_id = sp.id
  ) spi ON true
  LEFT JOIN public.v_dispatch_gate_pass vgp ON vgp.dispatch_id = dc.dispatch_id
  LEFT JOIN public.gate_passes gp ON gp.id = vgp.gate_pass_id
  LEFT JOIN LATERAL (
    SELECT sum(i.quantity) AS gp_quantity, sum(i.packages) AS gp_packages,
           sum(i.counted) FILTER (WHERE i.count_basis = 'packages') AS gp_counted_packages,
           sum(i.counted) FILTER (WHERE i.count_basis = 'quantity') AS gp_counted_quantity
      FROM public.gate_pass_items i
     WHERE i.gate_pass_id = gp.id AND i.dispatch_id = dc.dispatch_id
  ) gpi ON true;

GRANT SELECT ON public.v_store_gate_tracking TO anon, authenticated, service_role;

-- 3. Building and linking ----------------------------------------------------

-- Replace the pass's lines from what the keeper typed.
-- p_lines: [{ description, product_id, quantity, packages, remarks }]
CREATE OR REPLACE FUNCTION public.store_pass_build(p_id uuid, p_lines jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  DELETE FROM public.store_pass_items WHERE store_pass_id = p_id;

  INSERT INTO public.store_pass_items
    (store_pass_id, line_no, product_id, description, uom, quantity, packages, remarks)
  SELECT p_id, row_number() OVER (ORDER BY x.ord),
         NULLIF(x.val->>'product_id', '')::uuid,
         COALESCE(NULLIF(btrim(x.val->>'description'), ''), p.code || ' · ' || p.name, 'Item'),
         'dz',
         COALESCE(NULLIF(x.val->>'quantity', '')::numeric, 0),
         NULLIF(x.val->>'packages', '')::integer,
         NULLIF(btrim(x.val->>'remarks'), '')
    FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) WITH ORDINALITY AS x(val, ord)
    LEFT JOIN public.products p ON p.id = NULLIF(x.val->>'product_id', '')::uuid
   WHERE NULLIF(btrim(x.val->>'description'), '') IS NOT NULL
      OR NULLIF(x.val->>'product_id', '') IS NOT NULL
      OR COALESCE(NULLIF(x.val->>'quantity', '')::numeric, 0) > 0
      OR COALESCE(NULLIF(x.val->>'packages', '')::integer, 0) > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    RAISE EXCEPTION 'Add at least one item.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.store_pass_items WHERE store_pass_id = p_id AND quantity <= 0 AND COALESCE(packages, 0) <= 0) THEN
    RAISE EXCEPTION 'Every item needs a quantity (dozens or cartons).';
  END IF;
  RETURN v_n;
END;
$$;

-- Link a pass to the system dispatches it covers (replaces the links). Any
-- domestic dispatch that is not on another live store pass. Store roles and
-- gate pass managers (the office) may link; a cancelled pass cannot be linked.
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
  IF NOT (public.store_pass_can('create') OR public.store_pass_has_any_role(ARRAY['gate_pass_manager'])) THEN
    RAISE EXCEPTION 'You do not have permission to link store passes to dispatches.';
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

  DELETE FROM public.store_pass_dispatches WHERE store_pass_id = p_id;

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

-- A plan number that is a domestic dispatch number ("DC-00412", "dc 412", "412").
CREATE OR REPLACE FUNCTION public.store_pass_match_dispatch(p_plan text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sd.id
    FROM public.sales_dispatches sd
   WHERE sd.sales_segment = 'domestic'
     AND NULLIF(regexp_replace(COALESCE(p_plan, ''), '\D', '', 'g'), '') IS NOT NULL
     AND regexp_replace(sd.dispatch_number, '\D', '', 'g')::bigint
         = regexp_replace(p_plan, '\D', '', 'g')::bigint
     AND upper(regexp_replace(COALESCE(p_plan, ''), '[^A-Za-z]', '', 'g')) IN ('', 'DC')
   ORDER BY sd.created_at DESC
   LIMIT 1;
$$;

-- 4. Actions -----------------------------------------------------------------

-- Make or edit a draft; with p_issue, issue it in the same call. p_data:
-- { pass_date, dispatch_plan_no*, received_by_name, photo_path, remarks,
--   lines: [{ description, product_id, quantity, packages, remarks }],
--   dispatch_ids: [uuid] (optional; else matched from dispatch_plan_no) }
CREATE OR REPLACE FUNCTION public.store_pass_save(p_id uuid, p_data jsonb, p_issue boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_old public.store_passes%ROWTYPE;
  v_id uuid := p_id;
  v_plan text := NULLIF(upper(btrim(p_data->>'dispatch_plan_no')), '');
  v_ids uuid[];
  v_match uuid;
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
         party_name = 'Plan ' || v_plan,
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

  -- Links: the ones given, else the dispatch whose number the plan number is.
  IF p_data ? 'dispatch_ids' THEN
    SELECT array_agg(DISTINCT x::uuid) INTO v_ids
      FROM jsonb_array_elements_text(COALESCE(p_data->'dispatch_ids', '[]'::jsonb)) x;
    PERFORM public.store_pass_link_dispatches(v_id, v_ids);
  ELSE
    v_match := public.store_pass_match_dispatch(v_plan);
    IF v_match IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.store_pass_dispatches spd
                        JOIN public.store_passes sp ON sp.id = spd.store_pass_id
                       WHERE spd.dispatch_id = v_match AND sp.id <> v_id AND sp.status <> 'cancelled') THEN
      PERFORM public.store_pass_link_dispatches(v_id, ARRAY[v_match]);
    END IF;
  END IF;

  IF p_issue THEN
    PERFORM public.store_pass_issue(v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- The goods leave the store: needs the hand-over person and the photo of the
-- stock at the loading dock, then the pass is frozen and time-stamped.
CREATE OR REPLACE FUNCTION public.store_pass_issue(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  s public.store_passes%ROWTYPE;
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

  PERFORM public.store_pass_log(p_id, 'issued',
    (SELECT sum(quantity) || ' dz · ' || COALESCE(sum(packages), 0) || ' ctn handed over to '
       FROM public.store_pass_items WHERE store_pass_id = p_id) || s.received_by_name);
  RETURN 'issued';
END;
$$;

-- No dispatch snapshot any more: refresh and the snapshot helper go.
DROP FUNCTION IF EXISTS public.store_pass_refresh(uuid);
DROP FUNCTION IF EXISTS public.store_pass_current_lines(uuid);
DROP FUNCTION IF EXISTS public.store_pass_build(uuid, uuid[], jsonb);

-- 5. Reconciliation ----------------------------------------------------------

-- Issued passes with no linked dispatch join the day they were issued.
CREATE OR REPLACE FUNCTION public.store_pass_unlinked(p_from date, p_to date)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sp.id
    FROM public.store_passes sp
   WHERE sp.status = 'issued'
     AND public.store_pass_pk_date(sp.issued_at) BETWEEN p_from AND p_to
     AND NOT EXISTS (SELECT 1 FROM public.store_pass_dispatches d WHERE d.store_pass_id = sp.id);
$$;

-- The row type changes (plan number, link count), so the function is recreated.
DROP FUNCTION IF EXISTS public.store_pass_reconcile(date, date);
CREATE FUNCTION public.store_pass_reconcile(p_from date, p_to date)
RETURNS TABLE (
  dispatch_id uuid, dispatch_number text, dispatch_date date, dispatch_created_at timestamptz,
  delivery_status text, customer_name text, order_numbers text,
  dc_quantity numeric, dc_packages numeric,
  store_pass_id uuid, sp_number text, sp_status text, sp_issued_at timestamptz, sp_date date,
  sp_dispatch_plan_no text, sp_received_by text, sp_dispatch_count integer,
  sp_quantity numeric, sp_packages numeric,
  gate_pass_id uuid, gp_number text, gp_status text, gp_held_at timestamptz, gate_out_at timestamptz, out_date date,
  gp_quantity numeric, gp_packages numeric, gp_counted_packages numeric, gp_counted_quantity numeric,
  stage text,
  cancelled_sp_number text, cancelled_sp_reason text, cancelled_sp_at timestamptz,
  codes text[], high_codes integer, open_high integer, open_medium integer,
  explained jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT t.*,
           public.store_pass_pk_date(t.sp_issued_at) AS sp_date,
           public.store_pass_pk_date(t.gate_out_at) AS out_date,
           c.pass_number AS cancelled_sp_number, c.cancel_reason AS cancelled_sp_reason, c.cancelled_at AS cancelled_sp_at
      FROM public.v_store_gate_tracking t
      LEFT JOIN LATERAL (
        SELECT sp.pass_number, sp.cancel_reason, sp.cancelled_at
          FROM public.store_pass_dispatches spd
          JOIN public.store_passes sp ON sp.id = spd.store_pass_id
         WHERE spd.dispatch_id = t.dispatch_id AND sp.status = 'cancelled' AND sp.issued_at IS NOT NULL
           AND public.store_pass_pk_date(sp.cancelled_at) BETWEEN p_from AND p_to
         ORDER BY sp.cancelled_at DESC LIMIT 1
      ) c ON true
     WHERE t.dispatch_id IN (SELECT public.store_pass_recon_dispatch_ids(p_from, p_to))
  ),
  coded AS (
    SELECT b.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN b.gate_out_at IS NOT NULL AND b.sp_status IS DISTINCT FROM 'issued' THEN 'OUT_NO_SP' END,
             CASE WHEN b.sp_status = 'issued' AND b.stage IN ('issued','on_gate_pass','held') THEN 'SP_NOT_OUT' END,
             CASE WHEN b.sp_status = 'issued' AND b.gate_out_at IS NOT NULL AND b.sp_quantity IS NOT NULL AND (
                    CASE WHEN COALESCE(b.gp_counted_packages, b.gp_packages) IS NOT NULL AND b.sp_packages IS NOT NULL
                         THEN COALESCE(b.gp_counted_packages, b.gp_packages) <> b.sp_packages
                         ELSE COALESCE(b.gp_counted_quantity, b.gp_quantity) IS DISTINCT FROM b.sp_quantity END)
                  THEN 'SP_VS_GP' END,
             CASE WHEN b.sp_status = 'issued' AND b.sp_quantity IS NOT NULL
                       AND (b.sp_quantity <> b.dc_quantity OR (b.sp_packages IS NOT NULL AND b.sp_packages <> b.dc_packages)) THEN 'SP_VS_DC' END,
             CASE WHEN b.cancelled_sp_number IS NOT NULL THEN 'SP_CANCELLED_AFTER_ISSUE' END,
             CASE WHEN b.sp_date IS NOT NULL AND b.out_date IS NOT NULL AND b.sp_date <> b.out_date THEN 'CROSS_DAY' END,
             CASE WHEN b.stage IN ('no_store_pass','draft') AND b.delivery_status = 'pending' THEN 'DC_PENDING' END
           ]::text[], NULL) AS codes
      FROM base b
  )
  SELECT c.dispatch_id, c.dispatch_number, c.dispatch_date, c.dispatch_created_at,
         c.delivery_status, c.customer_name, c.order_numbers,
         c.dc_quantity, c.dc_packages,
         c.store_pass_id, c.sp_number, c.sp_status, c.sp_issued_at, c.sp_date,
         c.sp_dispatch_plan_no, c.sp_received_by, c.sp_dispatch_count::integer,
         c.sp_quantity, c.sp_packages,
         c.gate_pass_id, c.gp_number, c.gp_status, c.gp_held_at, c.gate_out_at, c.out_date,
         c.gp_quantity, c.gp_packages, c.gp_counted_packages, c.gp_counted_quantity,
         c.stage,
         c.cancelled_sp_number, c.cancelled_sp_reason, c.cancelled_sp_at,
         c.codes,
         (SELECT count(*) FROM unnest(c.codes) x WHERE public.store_pass_code_severity(x) = 'high')::integer,
         (SELECT count(*) FROM unnest(c.codes) x
           WHERE public.store_pass_code_severity(x) = 'high'
             AND NOT EXISTS (SELECT 1 FROM public.store_pass_recon_notes n WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = x))::integer,
         (SELECT count(*) FROM unnest(c.codes) x
           WHERE public.store_pass_code_severity(x) = 'medium'
             AND NOT EXISTS (SELECT 1 FROM public.store_pass_recon_notes n WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = x))::integer,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('code', n.discrepancy_code, 'note', n.note,
                                                       'by', u.full_name, 'at', n.resolved_at) ORDER BY n.resolved_at)
                     FROM public.store_pass_recon_notes n
                     LEFT JOIN public.app_users u ON u.id = n.resolved_by
                    WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = ANY (c.codes)), '[]'::jsonb)
    FROM coded c
  UNION ALL
  -- Issued store passes not linked to any dispatch: nothing to compare them with yet.
  SELECT NULL, NULL, NULL, NULL,
         NULL, NULL, NULL,
         NULL, NULL,
         sp.id, sp.pass_number, sp.status, sp.issued_at, public.store_pass_pk_date(sp.issued_at),
         sp.dispatch_plan_no, sp.received_by_name, 0,
         (SELECT sum(i.quantity) FROM public.store_pass_items i WHERE i.store_pass_id = sp.id),
         (SELECT sum(i.packages) FROM public.store_pass_items i WHERE i.store_pass_id = sp.id),
         NULL, NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL,
         'unlinked',
         NULL, NULL, NULL,
         ARRAY['SP_UNLINKED'], 0, 0, 1,
         '[]'::jsonb
    FROM public.store_passes sp
   WHERE sp.id IN (SELECT public.store_pass_unlinked(p_from, p_to))
   ORDER BY 2 NULLS LAST, 11;
$$;

CREATE OR REPLACE FUNCTION public.store_pass_code_severity(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_code
    WHEN 'OUT_NO_SP' THEN 'high' WHEN 'SP_NOT_OUT' THEN 'high' WHEN 'SP_VS_GP' THEN 'high'
    WHEN 'SP_VS_DC' THEN 'medium' WHEN 'DC_CHANGED' THEN 'medium' WHEN 'SP_UNLINKED' THEN 'medium'
    ELSE 'info' END;
$$;

-- Per product: store lines carry the product the keeper picked (else "Unspecified").
CREATE OR REPLACE FUNCTION public.store_pass_reconcile_products(p_from date, p_to date)
RETURNS TABLE (
  product_id uuid, product_code text, product_name text,
  dc_quantity numeric, dc_packages numeric,
  sp_quantity numeric, sp_packages numeric,
  gp_quantity numeric, gp_packages numeric, gp_counted_packages numeric, gp_counted_quantity numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ids AS (SELECT public.store_pass_recon_dispatch_ids(p_from, p_to) AS dispatch_id),
  dc AS (
    SELECT oi.product_id, sum(di.quantity_dozens) AS q, sum(COALESCE(di.packages, 0)) AS p
      FROM public.sales_dispatch_items di
      JOIN public.sales_order_items oi ON oi.id = di.order_item_id
     WHERE di.dispatch_id IN (SELECT dispatch_id FROM ids)
     GROUP BY oi.product_id
  ),
  sp AS (
    SELECT i.product_id, sum(i.quantity) AS q, sum(COALESCE(i.packages, 0)) AS p
      FROM public.store_pass_items i
      JOIN public.store_passes s ON s.id = i.store_pass_id
     WHERE s.status = 'issued'
       AND (s.id IN (SELECT spd.store_pass_id FROM public.store_pass_dispatches spd WHERE spd.dispatch_id IN (SELECT dispatch_id FROM ids))
            OR s.id IN (SELECT public.store_pass_unlinked(p_from, p_to)))
     GROUP BY i.product_id
  ),
  gp AS (
    SELECT i.product_id, sum(i.quantity) AS q, sum(COALESCE(i.packages, 0)) AS p,
           sum(i.counted) FILTER (WHERE i.count_basis = 'packages') AS cp,
           sum(i.counted) FILTER (WHERE i.count_basis = 'quantity') AS cq
      FROM public.gate_pass_items i
      JOIN public.gate_passes g ON g.id = i.gate_pass_id
     WHERE g.gate_out_at IS NOT NULL AND g.status NOT IN ('cancelled','rejected')
       AND i.dispatch_id IN (SELECT dispatch_id FROM ids)
     GROUP BY i.product_id
  ),
  all_products AS (
    SELECT product_id FROM dc UNION SELECT product_id FROM sp UNION SELECT product_id FROM gp
  )
  SELECT a.product_id, COALESCE(p.code, 'Unspecified'), p.name,
         COALESCE(dc.q, 0), COALESCE(dc.p, 0),
         COALESCE(sp.q, 0), COALESCE(sp.p, 0),
         COALESCE(gp.q, 0), COALESCE(gp.p, 0), gp.cp, gp.cq
    FROM all_products a
    LEFT JOIN public.products p ON p.id = a.product_id
    LEFT JOIN dc ON dc.product_id IS NOT DISTINCT FROM a.product_id
    LEFT JOIN sp ON sp.product_id IS NOT DISTINCT FROM a.product_id
    LEFT JOIN gp ON gp.product_id IS NOT DISTINCT FROM a.product_id
   ORDER BY p.code NULLS LAST;
$$;

-- 6. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.store_pass_link_dispatches(uuid, uuid[]),
  public.store_pass_save(uuid, jsonb, boolean),
  public.store_pass_issue(uuid),
  public.store_pass_reconcile(date, date),
  public.store_pass_reconcile_products(date, date),
  public.store_pass_code_severity(text)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.store_pass_build(uuid, jsonb),
  public.store_pass_match_dispatch(text),
  public.store_pass_unlinked(date, date)
FROM PUBLIC, anon, authenticated;
