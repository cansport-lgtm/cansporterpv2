-- ============================================================================
-- Store Pass — Step 1: passes, dispatch tracking
-- ----------------------------------------------------------------------------
-- A store pass records the finished goods the FG store hands over for one
-- vehicle, before that vehicle reaches the gate. One number series:
-- SP-000001, SP-000002, … given only when a pass saves successfully.
--
--   * One pass per VEHICLE, covering one or more pending DOMESTIC dispatches
--     (sales_dispatches, sales_segment = 'domestic') of approved sales orders —
--     the same shape as the sales gate pass. A dispatch can be on only one live
--     (not cancelled) store pass.
--   * Lines are copied from the dispatch items (the dispatch figures are kept
--     as a snapshot) and the store keeper confirms or corrects what was
--     actually ISSUED. Short issue needs a remark on the line; issuing more
--     than the dispatch is refused — the office corrects the dispatch first.
--   * No approval: draft → issued (→ cancelled). Issuing stamps who and when.
--     After issue only a store pass manager can cancel it (with a reason);
--     the keeper then makes a new one.
--   * NO stock effect and NO prices: the dispatch already moves finished goods
--     (WIP ledger FG level, COGS). The store pass is a control document that the
--     daily store ↔ gate reconciliation (step 2) compares with the dispatch and
--     with what the gate guard counted.
--
-- v_dispatch_store_pass gives the live store pass of each dispatch (dispatch
-- list columns, gate pass form). v_store_gate_tracking is one row per domestic
-- dispatch with its dispatch, store pass and gate pass figures and the stage
-- it has reached (Dispatch Tracking page; the reconciliation builds on it).
--
-- All tables are read-only to clients: writes go through the SECURITY DEFINER
-- functions below, which check the acting user's role via app_user_id().
-- Roles are added in 20261008120000_store_pass_roles.sql.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.store_pass_number_seq;

CREATE TABLE IF NOT EXISTS public.store_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_number text NOT NULL UNIQUE
    DEFAULT 'SP-' || lpad(nextval('public.store_pass_number_seq')::text, 6, '0'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','cancelled')),
  pass_date date NOT NULL DEFAULT CURRENT_DATE,
  vehicle_number text,
  driver_name text,
  driver_contact text,
  -- The customers whose dispatches travel on this vehicle ("A; B").
  party_name text NOT NULL,
  received_by_name text,
  store_location text,
  photo_path text,
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  issued_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS store_passes_status_idx ON public.store_passes (status, pass_date);
CREATE INDEX IF NOT EXISTS store_passes_issued_idx ON public.store_passes (issued_at);

-- Which dispatches travel on a pass (one vehicle, many dispatches).
CREATE TABLE IF NOT EXISTS public.store_pass_dispatches (
  store_pass_id uuid NOT NULL REFERENCES public.store_passes(id) ON DELETE CASCADE,
  dispatch_id uuid NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_pass_id, dispatch_id)
);
CREATE INDEX IF NOT EXISTS store_pass_dispatches_dispatch_idx ON public.store_pass_dispatches (dispatch_id);

CREATE TABLE IF NOT EXISTS public.store_pass_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_pass_id uuid NOT NULL REFERENCES public.store_passes(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  dispatch_id uuid NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE RESTRICT,
  dispatch_item_id uuid REFERENCES public.sales_dispatch_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  description text NOT NULL,
  packing_type text,
  uom text NOT NULL DEFAULT 'dz',
  -- What the dispatch said when the pass was built / last refreshed.
  dispatch_quantity numeric NOT NULL CHECK (dispatch_quantity >= 0),
  dispatch_packages integer CHECK (dispatch_packages IS NULL OR dispatch_packages >= 0),
  -- What the store actually handed over.
  quantity numeric NOT NULL CHECK (quantity >= 0),
  packages integer CHECK (packages IS NULL OR packages >= 0),
  remarks text
);
CREATE INDEX IF NOT EXISTS store_pass_items_pass_idx ON public.store_pass_items (store_pass_id, line_no);
CREATE INDEX IF NOT EXISTS store_pass_items_dispatch_idx ON public.store_pass_items (dispatch_id);
CREATE INDEX IF NOT EXISTS store_pass_items_dispatch_item_idx ON public.store_pass_items (dispatch_item_id);

-- Every state change, with details of anything altered.
CREATE TABLE IF NOT EXISTS public.store_pass_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_pass_id uuid NOT NULL REFERENCES public.store_passes(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS store_pass_events_pass_idx ON public.store_pass_events (store_pass_id, created_at);

-- Read-only to clients: SELECT policies only, so every write goes through the
-- role-checked functions below. No prices are stored on a pass.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_passes','store_pass_dispatches','store_pass_items','store_pass_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Views -------------------------------------------------------------------

-- The live (not cancelled) store pass of each dispatch.
CREATE OR REPLACE VIEW public.v_dispatch_store_pass AS
SELECT DISTINCT ON (spd.dispatch_id)
       spd.dispatch_id, sp.id AS store_pass_id, sp.pass_number, sp.status, sp.issued_at
  FROM public.store_pass_dispatches spd
  JOIN public.store_passes sp ON sp.id = spd.store_pass_id
 WHERE sp.status <> 'cancelled'
 ORDER BY spd.dispatch_id, sp.created_at DESC;

-- One row per domestic dispatch: office (DC) → store (SP) → gate (GP) → out →
-- delivered, with the figures of each document and the stage reached.
-- Gate counts: the guard counts cartons where a line has them, else dozens, so
-- both counted sums are given and the page shows whichever applies.
CREATE OR REPLACE VIEW public.v_store_gate_tracking AS
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
       sp.issued_at AS sp_issued_at, sp.vehicle_number AS sp_vehicle, sp.created_at AS sp_created_at,
       spi.sp_quantity, spi.sp_packages, spi.sp_dispatch_quantity, spi.sp_dispatch_packages,
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
    SELECT sum(i.quantity) AS sp_quantity, sum(i.packages) AS sp_packages,
           sum(i.dispatch_quantity) AS sp_dispatch_quantity, sum(i.dispatch_packages) AS sp_dispatch_packages
      FROM public.store_pass_items i
     WHERE i.store_pass_id = sp.id AND i.dispatch_id = dc.dispatch_id
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

GRANT SELECT ON public.v_dispatch_store_pass, public.v_store_gate_tracking
  TO anon, authenticated, service_role;

-- 3. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_pass_has_any_role(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = public.app_user_id() AND role::text = ANY (p_roles)
  );
$$;

-- create → make, issue and print passes; edit / cancel own drafts
-- manage → cancel any pass (issued too), explain discrepancies
CREATE OR REPLACE FUNCTION public.store_pass_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.store_pass_has_any_role(CASE p_action
    WHEN 'create' THEN ARRAY['super_admin','store_pass_manager','store_pass_officer']
    WHEN 'manage' THEN ARRAY['super_admin','store_pass_manager']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.store_pass_log(
  p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.store_pass_events (store_pass_id, event, message, details, created_by)
  VALUES (p_id, p_event, p_message, p_details, public.app_user_id());
$$;

-- Notify the store pass managers and / or the pass maker, never the actor.
CREATE OR REPLACE FUNCTION public.store_pass_notify(
  p_pass public.store_passes, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_maker boolean DEFAULT true, p_to_managers boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_link text := '/store-pass/passes/' || p_pass.id::text;
BEGIN
  IF p_to_managers THEN
    PERFORM public.notify_role(
      ARRAY['super_admin','store_pass_manager']::app_role[], p_title, p_message, p_type,
      'store_pass', v_link, 'store_pass', p_pass.id, v_uid, v_uid);
  END IF;
  IF p_to_maker AND p_pass.created_by IS NOT NULL AND p_pass.created_by IS DISTINCT FROM v_uid
     AND NOT (p_to_managers AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = p_pass.created_by AND role::text IN ('super_admin','store_pass_manager'))) THEN
    PERFORM public.notify_user(p_pass.created_by, p_title, p_message, p_type,
      'store_pass', v_link, 'store_pass', p_pass.id, v_uid);
  END IF;
END;
$$;

-- 4. Building the pass from its dispatches -----------------------------------

-- Rebuild a pass's dispatch links and lines from the dispatches given. Every
-- dispatch must be domestic, still pending (the vehicle has not left), not on
-- another live store pass, and belong only to approved sales orders.
-- p_lines: [{ dispatch_item_id, quantity, packages, remarks }] — the issued
-- figures per dispatch item; a line not given keeps the dispatch figures.
-- Returns the customers' names.
CREATE OR REPLACE FUNCTION public.store_pass_build(p_id uuid, p_dispatch_ids uuid[], p_lines jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d record;
  v_other text;
  v_bad text;
  v_line integer := 0;
  v_n integer;
  v_party text;
BEGIN
  IF p_dispatch_ids IS NULL OR cardinality(p_dispatch_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one dispatch for this vehicle.';
  END IF;

  DELETE FROM public.store_pass_items WHERE store_pass_id = p_id;
  DELETE FROM public.store_pass_dispatches WHERE store_pass_id = p_id;

  FOR d IN
    SELECT sd.* FROM public.sales_dispatches sd
     WHERE sd.id = ANY (p_dispatch_ids)
     ORDER BY sd.dispatch_number
       FOR UPDATE
  LOOP
    IF d.sales_segment::text <> 'domestic' THEN
      RAISE EXCEPTION 'Dispatch % is not a domestic dispatch. Store passes cover domestic sales dispatches only.', d.dispatch_number;
    END IF;
    IF d.delivery_status <> 'pending' THEN
      RAISE EXCEPTION 'Dispatch % is already % — a store pass must be made before the vehicle leaves.',
        d.dispatch_number, replace(d.delivery_status, '_', ' ');
    END IF;

    SELECT sp.pass_number INTO v_other
      FROM public.store_pass_dispatches spd
      JOIN public.store_passes sp ON sp.id = spd.store_pass_id
     WHERE spd.dispatch_id = d.id AND sp.id <> p_id AND sp.status <> 'cancelled'
     LIMIT 1;
    IF v_other IS NOT NULL THEN
      RAISE EXCEPTION 'Dispatch % is already on store pass %.', d.dispatch_number, v_other;
    END IF;

    SELECT string_agg(so.order_number || ' (' || so.status || ')', ', ') INTO v_bad
      FROM public.sales_orders so
     WHERE (so.id = d.order_id
            OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = d.id))
       AND so.status IN ('draft','pending','cancelled');
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Dispatch % has sales orders that are not approved: %.', d.dispatch_number, v_bad;
    END IF;

    INSERT INTO public.store_pass_dispatches (store_pass_id, dispatch_id) VALUES (p_id, d.id);

    INSERT INTO public.store_pass_items
      (store_pass_id, line_no, dispatch_id, dispatch_item_id, product_id, description, packing_type, uom,
       dispatch_quantity, dispatch_packages, quantity, packages, remarks)
    SELECT p_id, v_line + row_number() OVER (ORDER BY p.code, di.created_at, di.id),
           d.id, di.id, oi.product_id,
           COALESCE(p.code || ' · ' || p.name, 'Item'),
           NULLIF(di.packing_type, ''), 'dz',
           di.quantity_dozens, di.packages,
           COALESCE(l.quantity, di.quantity_dozens), COALESCE(l.packages, di.packages), l.remarks
      FROM public.sales_dispatch_items di
      JOIN public.sales_order_items oi ON oi.id = di.order_item_id
      LEFT JOIN public.products p ON p.id = oi.product_id
      LEFT JOIN LATERAL (
        SELECT NULLIF(x->>'quantity', '')::numeric AS quantity,
               NULLIF(x->>'packages', '')::integer AS packages,
               NULLIF(btrim(x->>'remarks'), '') AS remarks
          FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) x
         WHERE x->>'dispatch_item_id' = di.id::text
         LIMIT 1
      ) l ON true
     WHERE di.dispatch_id = d.id AND di.quantity_dozens > 0;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'Dispatch % has no items.', d.dispatch_number;
    END IF;
    v_line := v_line + v_n;
  END LOOP;

  IF (SELECT count(*) FROM public.store_pass_dispatches WHERE store_pass_id = p_id)
     <> (SELECT count(DISTINCT x) FROM unnest(p_dispatch_ids) x) THEN
    RAISE EXCEPTION 'One of the selected dispatches no longer exists.';
  END IF;

  -- The store can issue less than the dispatch (with a reason), never more.
  SELECT string_agg(i.line_no || ' ' || i.description, ', ' ORDER BY i.line_no) INTO v_bad
    FROM public.store_pass_items i
   WHERE i.store_pass_id = p_id
     AND (i.quantity > i.dispatch_quantity OR COALESCE(i.packages, 0) > COALESCE(i.dispatch_packages, 0));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Issued more than the dispatch on line %. The store cannot issue more than the dispatch — ask the office to correct the dispatch first.', v_bad;
  END IF;
  SELECT string_agg(i.line_no::text, ', ' ORDER BY i.line_no) INTO v_bad
    FROM public.store_pass_items i
   WHERE i.store_pass_id = p_id AND i.remarks IS NULL
     AND (i.quantity < i.dispatch_quantity OR COALESCE(i.packages, 0) < COALESCE(i.dispatch_packages, 0));
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Line % is short of the dispatch: write a remark saying why.', v_bad;
  END IF;

  SELECT COALESCE(string_agg(DISTINCT cu.name, '; ' ORDER BY cu.name), 'Customer') INTO v_party
    FROM public.store_pass_dispatches spd
    JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
    JOIN public.sales_orders so
      ON so.id = sd.order_id
      OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)
    JOIN public.customers cu ON cu.id = so.customer_id
   WHERE spd.store_pass_id = p_id;
  RETURN v_party;
END;
$$;

-- The pass's current lines as the p_lines payload of store_pass_build, so a
-- rebuild (issue, refresh) keeps the store keeper's issued figures. Issued
-- figures are clamped to the dispatch as it is now, so a dispatch corrected
-- downwards never leaves the pass over it.
CREATE OR REPLACE FUNCTION public.store_pass_current_lines(p_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'dispatch_item_id', i.dispatch_item_id,
           'quantity', LEAST(i.quantity, di.quantity_dozens),
           'packages', CASE WHEN i.packages IS NULL THEN NULL ELSE LEAST(i.packages, COALESCE(di.packages, 0)) END,
           'remarks', i.remarks)), '[]'::jsonb)
    FROM public.store_pass_items i
    JOIN public.sales_dispatch_items di ON di.id = i.dispatch_item_id
   WHERE i.store_pass_id = p_id;
$$;

-- 5. Actions -----------------------------------------------------------------

-- Make or edit a draft; with p_issue, issue it in the same call. p_data:
-- { pass_date, vehicle_number*, driver_name, driver_contact, received_by_name,
--   store_location, photo_path, remarks, dispatch_ids: [uuid], lines: [...] }
CREATE OR REPLACE FUNCTION public.store_pass_save(p_id uuid, p_data jsonb, p_issue boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_old public.store_passes%ROWTYPE;
  v_id uuid := p_id;
  v_ids uuid[];
  v_party text;
  v_vehicle text := NULLIF(upper(btrim(p_data->>'vehicle_number')), '');
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

  IF v_vehicle IS NULL THEN
    RAISE EXCEPTION 'Enter the vehicle number.';
  END IF;

  SELECT array_agg(DISTINCT x::uuid) INTO v_ids
    FROM jsonb_array_elements_text(COALESCE(p_data->'dispatch_ids', '[]'::jsonb)) x;
  v_party := public.store_pass_build(v_id, v_ids, p_data->'lines');

  UPDATE public.store_passes
     SET pass_date = COALESCE(NULLIF(p_data->>'pass_date', '')::date, pass_date),
         vehicle_number = v_vehicle,
         driver_name = NULLIF(btrim(p_data->>'driver_name'), ''),
         driver_contact = NULLIF(btrim(p_data->>'driver_contact'), ''),
         party_name = v_party,
         received_by_name = NULLIF(btrim(p_data->>'received_by_name'), ''),
         store_location = NULLIF(btrim(p_data->>'store_location'), ''),
         photo_path = NULLIF(btrim(p_data->>'photo_path'), ''),
         remarks = NULLIF(btrim(p_data->>'remarks'), ''),
         pass_number = CASE WHEN p_id IS NULL
                            THEN 'SP-' || lpad(nextval('public.store_pass_number_seq')::text, 6, '0')
                            ELSE pass_number END,
         updated_at = now()
   WHERE id = v_id;

  PERFORM public.store_pass_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END,
    (SELECT count(DISTINCT dispatch_id) || ' dispatch(es) · ' || sum(quantity) || ' dz · ' || COALESCE(sum(packages), 0) || ' ctn'
       FROM public.store_pass_items WHERE store_pass_id = v_id));

  IF p_issue THEN
    PERFORM public.store_pass_issue(v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- The goods leave the store: the pass is re-checked against its dispatches as
-- they are now (keeping the issued figures), then frozen and time-stamped.
CREATE OR REPLACE FUNCTION public.store_pass_issue(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  s public.store_passes%ROWTYPE;
  v_ids uuid[];
  v_short integer;
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

  SELECT array_agg(dispatch_id) INTO v_ids FROM public.store_pass_dispatches WHERE store_pass_id = p_id;
  UPDATE public.store_passes
     SET party_name = public.store_pass_build(p_id, v_ids, public.store_pass_current_lines(p_id))
   WHERE id = p_id;

  UPDATE public.store_passes
     SET status = 'issued', issued_by = v_uid, issued_at = now(), updated_at = now()
   WHERE id = p_id;

  SELECT count(*) INTO v_short
    FROM public.store_pass_items i
   WHERE i.store_pass_id = p_id
     AND (i.quantity < i.dispatch_quantity OR COALESCE(i.packages, 0) < COALESCE(i.dispatch_packages, 0));

  PERFORM public.store_pass_log(p_id, 'issued',
    (SELECT sum(quantity) || ' dz · ' || COALESCE(sum(packages), 0) || ' ctn handed over'
       FROM public.store_pass_items WHERE store_pass_id = p_id)
    || CASE WHEN v_short > 0 THEN ' · ' || v_short || ' line(s) short of the dispatch' ELSE '' END,
    jsonb_build_object('short_lines', v_short));
  RETURN 'issued';
END;
$$;

-- Cancel: the maker (or a manager) can cancel a draft; only a manager can
-- cancel an issued pass, with a reason. The dispatches become free for a new pass.
CREATE OR REPLACE FUNCTION public.store_pass_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.store_passes%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  SELECT * INTO s FROM public.store_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store pass not found.';
  END IF;
  IF s.status = 'cancelled' THEN
    RAISE EXCEPTION 'Store pass % is already cancelled.', s.pass_number;
  END IF;
  IF NOT (public.store_pass_can('manage')
          OR (public.store_pass_can('create') AND s.created_by = v_uid AND s.status = 'draft')) THEN
    RAISE EXCEPTION 'Only a store pass manager can cancel an issued store pass.';
  END IF;
  IF s.status <> 'draft' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the pass.';
  END IF;

  UPDATE public.store_passes
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
         cancel_reason = NULLIF(btrim(p_reason), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO s;
  PERFORM public.store_pass_log(p_id, 'cancelled', NULLIF(btrim(p_reason), ''),
    jsonb_build_object('was', CASE WHEN s.issued_at IS NOT NULL THEN 'issued' ELSE 'draft' END));
  IF s.issued_at IS NOT NULL THEN
    PERFORM public.store_pass_notify(s, 'Issued store pass cancelled',
      s.pass_number || ' (' || s.party_name || ', ' || COALESCE(s.vehicle_number, '') || ')'
        || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''),
      'warning', true, true);
  END IF;
END;
$$;

-- Draft only: re-read the dispatches (the office may have edited them) and
-- keep the issued figures, clamped to the new dispatch figures.
CREATE OR REPLACE FUNCTION public.store_pass_refresh(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.store_passes%ROWTYPE;
  v_ids uuid[];
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF NOT public.store_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to change store passes.';
  END IF;
  SELECT * INTO s FROM public.store_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Store pass not found.';
  END IF;
  IF s.status <> 'draft' THEN
    RAISE EXCEPTION 'Store pass % is % — only a draft can be refreshed. Cancel it and make a new one.', s.pass_number, s.status;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('item', dispatch_item_id, 'dq', dispatch_quantity, 'dp', dispatch_packages, 'q', quantity, 'p', packages) ORDER BY line_no)
    INTO v_before FROM public.store_pass_items WHERE store_pass_id = p_id;
  SELECT array_agg(dispatch_id) INTO v_ids FROM public.store_pass_dispatches WHERE store_pass_id = p_id;
  UPDATE public.store_passes
     SET party_name = public.store_pass_build(p_id, v_ids, public.store_pass_current_lines(p_id)), updated_at = now()
   WHERE id = p_id;
  SELECT jsonb_agg(jsonb_build_object('item', dispatch_item_id, 'dq', dispatch_quantity, 'dp', dispatch_packages, 'q', quantity, 'p', packages) ORDER BY line_no)
    INTO v_after FROM public.store_pass_items WHERE store_pass_id = p_id;
  IF v_before IS DISTINCT FROM v_after THEN
    PERFORM public.store_pass_log(p_id, 'refreshed', 'Lines re-read from the dispatches', jsonb_build_object('before', v_before));
    RETURN 1;
  END IF;
  RETURN 0;
END;
$$;

-- 6. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.store_pass_has_any_role(text[]),
  public.store_pass_can(text),
  public.store_pass_save(uuid, jsonb, boolean),
  public.store_pass_issue(uuid),
  public.store_pass_cancel(uuid, text),
  public.store_pass_refresh(uuid)
TO anon, authenticated, service_role;

-- Internal building blocks: only callable from the functions above.
REVOKE EXECUTE ON FUNCTION
  public.store_pass_log(uuid, text, text, jsonb),
  public.store_pass_notify(public.store_passes, text, text, text, boolean, boolean),
  public.store_pass_build(uuid, uuid[], jsonb),
  public.store_pass_current_lines(uuid)
FROM PUBLIC, anon, authenticated;
