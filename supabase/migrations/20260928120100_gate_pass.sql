-- ============================================================================
-- Gate Pass (outward) — Phase 1: Sales, Sample, Supplier return
-- ----------------------------------------------------------------------------
-- Every outward movement through the gate gets a pass from ONE number series
-- (GP-000001 …). Phase 1 covers three types:
--
--   sales            One pass per vehicle, covering one or more dispatches
--                    (sales_dispatches) of approved sales orders. Approved
--                    automatically on submit. Posts NO stock — the dispatch
--                    already did. When the vehicle goes out, its pending
--                    dispatches are set to In Transit.
--   supplier_return  Rejected material going back on a purchase return.
--                    Approved automatically on submit. Posts NO stock — the
--                    purchase return already did.
--   sample           Free samples to a customer, distributor or anyone else.
--                    Needs manager approval. Finished-goods lines are issued
--                    out of stock (stock_movements + the WIP ledger's FG level,
--                    via v_gate_pass_fg_samples) when the vehicle goes out.
--
-- Flow: draft → (pending_approval →) approved → out
--                                      ↘ held (guard's count did not match)
--                                          → out, after a manager releases it
-- A pass can be cancelled until it is out; a pending one can be rejected.
--
-- At the gate the guard counts every line (cartons where the line has them,
-- otherwise the quantity) and enters the vehicle number. All equal → Out.
-- Anything different → Held, and the pass maker + managers are notified.
-- A manager can release a held pass only when nothing is over the pass: the
-- lines are cut down to what was counted (the original stays in
-- original_quantity and the event log). For a sales pass the dispatch must be
-- corrected first; release re-reads the dispatch and needs it to match.
--
-- Nothing in the existing dispatch, invoice, COGS or purchase flows changes.
-- The only effect on them is the In Transit status above.
--
-- All tables are read-only to clients: writes go through the SECURITY DEFINER
-- functions below, which check the acting user's role via app_user_id().
-- Roles are added in 20260928120000_gate_pass_roles.sql.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.gate_pass_number_seq;

CREATE TABLE IF NOT EXISTS public.gate_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_number text NOT NULL UNIQUE
    DEFAULT 'GP-' || lpad(nextval('public.gate_pass_number_seq')::text, 6, '0'),
  pass_type text NOT NULL
    CHECK (pass_type IN ('sales','sample','returnable','job_work','supplier_return','scrap')),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','held','out',
                      'partially_returned','returned','closed','rejected','cancelled')),
  pass_date date NOT NULL DEFAULT CURRENT_DATE,
  party_kind text CHECK (party_kind IN ('customer','distributor','supplier','other')),
  party_id uuid,
  party_name text NOT NULL,
  vehicle_number text,
  driver_name text,
  driver_contact text,
  transporter_name text,
  purchase_return_id uuid REFERENCES public.purchase_returns(id) ON DELETE RESTRICT,
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  approved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approval_remarks text,
  gate_vehicle_number text,
  held_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  held_at timestamptz,
  hold_note text,
  released_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  released_at timestamptz,
  release_reason text,
  gate_out_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  gate_out_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS gate_passes_status_idx ON public.gate_passes (status, pass_date);
CREATE INDEX IF NOT EXISTS gate_passes_type_idx ON public.gate_passes (pass_type, pass_date);
CREATE INDEX IF NOT EXISTS gate_passes_purchase_return_idx ON public.gate_passes (purchase_return_id);

CREATE TABLE IF NOT EXISTS public.gate_pass_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE RESTRICT,
  dispatch_id uuid REFERENCES public.sales_dispatches(id) ON DELETE RESTRICT,
  dispatch_item_id uuid REFERENCES public.sales_dispatch_items(id) ON DELETE SET NULL,
  purchase_return_item_id uuid REFERENCES public.purchase_return_items(id) ON DELETE SET NULL,
  description text NOT NULL,
  uom text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  packages integer CHECK (packages IS NULL OR packages >= 0),
  -- What the guard counts: cartons when the line has them, else the quantity.
  count_basis text NOT NULL DEFAULT 'quantity' CHECK (count_basis IN ('quantity','packages')),
  -- Set when a release or a dispatch change altered the line; the value first printed.
  original_quantity numeric,
  original_packages integer,
  counted numeric CHECK (counted IS NULL OR counted >= 0),
  counted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  counted_at timestamptz,
  remarks text
);
CREATE INDEX IF NOT EXISTS gate_pass_items_pass_idx ON public.gate_pass_items (gate_pass_id, line_no);
CREATE INDEX IF NOT EXISTS gate_pass_items_dispatch_item_idx ON public.gate_pass_items (dispatch_item_id);

-- Which dispatches travel on a sales pass (one vehicle, many dispatches).
CREATE TABLE IF NOT EXISTS public.gate_pass_dispatches (
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  dispatch_id uuid NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gate_pass_id, dispatch_id)
);
CREATE INDEX IF NOT EXISTS gate_pass_dispatches_dispatch_idx ON public.gate_pass_dispatches (dispatch_id);

-- Every state change, with the before/after of anything that was altered.
CREATE TABLE IF NOT EXISTS public.gate_pass_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_pass_events_pass_idx ON public.gate_pass_events (gate_pass_id, created_at);

-- Read-only to clients: SELECT policies only, so every write goes through the
-- role-checked functions below. No prices are stored on a pass, so the guard
-- reading these tables sees nothing commercial.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gate_passes','gate_pass_items','gate_pass_dispatches','gate_pass_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Views -------------------------------------------------------------------

-- The live (not cancelled / rejected) gate pass of each dispatch, for the
-- Gate pass no. and Gate out columns on the dispatch pages.
CREATE OR REPLACE VIEW public.v_dispatch_gate_pass AS
SELECT DISTINCT ON (gd.dispatch_id)
       gd.dispatch_id, g.id AS gate_pass_id, g.pass_number, g.status, g.gate_out_at
  FROM public.gate_pass_dispatches gd
  JOIN public.gate_passes g ON g.id = gd.gate_pass_id
 WHERE g.status NOT IN ('cancelled','rejected')
 ORDER BY gd.dispatch_id, g.created_at DESC;

-- Finished-goods samples that left the gate, in dozens, dated in factory time.
-- The WIP ledger subtracts these from the FG level next to Sales.
CREATE OR REPLACE VIEW public.v_gate_pass_fg_samples AS
SELECT (g.gate_out_at AT TIME ZONE 'Asia/Karachi')::date AS out_date,
       g.id AS gate_pass_id, g.pass_number, i.product_id,
       CASE i.uom WHEN 'pcs' THEN i.quantity / 12 ELSE i.quantity END AS quantity_dozens
  FROM public.gate_passes g
  JOIN public.gate_pass_items i ON i.gate_pass_id = g.id
 WHERE g.pass_type = 'sample' AND g.status = 'out' AND i.product_id IS NOT NULL;

GRANT SELECT ON public.v_dispatch_gate_pass, public.v_gate_pass_fg_samples
  TO anon, authenticated, service_role;

-- 3. Helpers -----------------------------------------------------------------

-- Does the acting user hold any of these roles? Compared as text so this file
-- never casts to the enum values added by the roles migration.
CREATE OR REPLACE FUNCTION public.gate_pass_has_any_role(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = public.app_user_id() AND role::text = ANY (p_roles)
  );
$$;

-- create  → make and submit passes
-- approve → approve / reject, release held passes, cancel any pass
-- gate    → count at the gate, mark Out or hold
CREATE OR REPLACE FUNCTION public.gate_pass_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'create'  THEN ARRAY['super_admin','gate_pass_manager','gate_pass_officer']
    WHEN 'approve' THEN ARRAY['super_admin','gate_pass_manager']
    WHEN 'gate'    THEN ARRAY['super_admin','gate_pass_manager','gate_security']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_log(
  p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.gate_pass_events (gate_pass_id, event, message, details, created_by)
  VALUES (p_id, p_event, p_message, p_details, public.app_user_id());
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_norm_vehicle(p text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT NULLIF(upper(regexp_replace(COALESCE(p, ''), '[^A-Za-z0-9]', '', 'g')), ''); $$;

-- The number the guard must count on a line.
CREATE OR REPLACE FUNCTION public.gate_pass_expected(i public.gate_pass_items)
RETURNS numeric LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE i.count_basis WHEN 'packages' THEN COALESCE(i.packages, 0)::numeric ELSE i.quantity END; $$;

-- Notify the pass maker and the managers, never the actor.
CREATE OR REPLACE FUNCTION public.gate_pass_notify(
  p_pass public.gate_passes, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_maker boolean DEFAULT true, p_to_managers boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_link text := '/gate-pass/passes/' || p_pass.id::text;
BEGIN
  IF p_to_managers THEN
    PERFORM public.notify_role(
      ARRAY['super_admin','gate_pass_manager']::app_role[], p_title, p_message, p_type,
      'gate_pass', v_link, 'gate_pass', p_pass.id, v_uid, v_uid);
  END IF;
  IF p_to_maker AND p_pass.created_by IS NOT NULL AND p_pass.created_by IS DISTINCT FROM v_uid
     AND NOT (p_to_managers AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = p_pass.created_by AND role::text IN ('super_admin','gate_pass_manager'))) THEN
    PERFORM public.notify_user(p_pass.created_by, p_title, p_message, p_type,
      'gate_pass', v_link, 'gate_pass', p_pass.id, v_uid);
  END IF;
END;
$$;

-- 4. Building lines from source documents ------------------------------------

-- Rebuild a sales pass's dispatch links and lines from the dispatches given.
-- Every dispatch must be undelivered, not on another live pass, and belong
-- only to approved sales orders. Returns the customers' names.
CREATE OR REPLACE FUNCTION public.gate_pass_build_sales(p_id uuid, p_dispatch_ids uuid[])
RETURNS TABLE (party_name text, party_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  d record;
  v_other text;
  v_bad text;
  v_line integer := 0;
  v_n integer;
BEGIN
  IF p_dispatch_ids IS NULL OR cardinality(p_dispatch_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one dispatch for this vehicle.';
  END IF;

  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  DELETE FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id;

  FOR d IN
    SELECT sd.* FROM public.sales_dispatches sd
     WHERE sd.id = ANY (p_dispatch_ids)
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

  IF (SELECT count(*) FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id)
     <> (SELECT count(DISTINCT x) FROM unnest(p_dispatch_ids) x) THEN
    RAISE EXCEPTION 'One of the selected dispatches no longer exists.';
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

-- Bring a sales pass's lines in line with its dispatches as they are now
-- (a dispatch edited after the pass was made). Keeps the guard's counts and
-- the first printed figures. Returns how many lines changed.
CREATE OR REPLACE FUNCTION public.gate_pass_sync_sales(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_m integer;
BEGIN
  UPDATE public.gate_pass_items i
     SET original_quantity = COALESCE(i.original_quantity, i.quantity),
         original_packages = COALESCE(i.original_packages, i.packages),
         quantity = di.quantity_dozens,
         packages = di.packages,
         count_basis = CASE WHEN COALESCE(di.packages, 0) > 0 THEN 'packages' ELSE 'quantity' END
    FROM public.sales_dispatch_items di
   WHERE i.gate_pass_id = p_id AND di.id = i.dispatch_item_id
     AND (di.quantity_dozens IS DISTINCT FROM i.quantity OR di.packages IS DISTINCT FROM i.packages);
  GET DIAGNOSTICS v_m = ROW_COUNT;
  v_n := v_n + v_m;

  -- A dispatch line deleted since: nothing of it is leaving any more.
  UPDATE public.gate_pass_items i
     SET original_quantity = COALESCE(i.original_quantity, i.quantity),
         original_packages = COALESCE(i.original_packages, i.packages),
         quantity = 0, packages = CASE WHEN i.packages IS NULL THEN NULL ELSE 0 END
   WHERE i.gate_pass_id = p_id AND i.dispatch_id IS NOT NULL AND i.quantity <> 0
     AND (i.dispatch_item_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM public.sales_dispatch_items di WHERE di.id = i.dispatch_item_id));
  GET DIAGNOSTICS v_m = ROW_COUNT;
  v_n := v_n + v_m;
  RETURN v_n;
END;
$$;

-- Lines of a supplier-return pass from its purchase return.
CREATE OR REPLACE FUNCTION public.gate_pass_build_supplier_return(p_id uuid, p_return_id uuid)
RETURNS TABLE (party_name text, party_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_other text;
  v_n integer;
BEGIN
  SELECT pr.*, s.name AS supplier_name INTO r
    FROM public.purchase_returns pr
    LEFT JOIN public.suppliers s ON s.id = pr.supplier_id
   WHERE pr.id = p_return_id
     FOR UPDATE OF pr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select the purchase return this material is going back on.';
  END IF;
  IF r.status = 'cancelled' THEN
    RAISE EXCEPTION 'Purchase return % is cancelled.', COALESCE(r.return_number, '');
  END IF;
  SELECT g.pass_number INTO v_other
    FROM public.gate_passes g
   WHERE g.purchase_return_id = p_return_id AND g.id <> p_id
     AND g.status NOT IN ('cancelled','rejected')
   LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase return % is already on gate pass %.', COALESCE(r.return_number, ''), v_other;
  END IF;

  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  INSERT INTO public.gate_pass_items
    (gate_pass_id, line_no, purchase_return_item_id, description, uom, quantity, count_basis)
  SELECT p_id, row_number() OVER (ORDER BY ri.line_order, ri.id), ri.id,
         COALESCE(NULLIF(it.code || ' · ' || it.name, ''), NULLIF(ri.description, ''), 'Item'),
         COALESCE(NULLIF(u.symbol, ''), 'unit'), ri.quantity, 'quantity'
    FROM public.purchase_return_items ri
    LEFT JOIN public.items it ON it.id = ri.item_id
    LEFT JOIN public.units_of_measure u ON u.id = it.uom_id
   WHERE ri.return_id = p_return_id AND ri.quantity > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Purchase return % has no items.', COALESCE(r.return_number, '');
  END IF;

  RETURN QUERY SELECT COALESCE(r.supplier_name, 'Supplier'), r.supplier_id;
END;
$$;

-- Lines of a sample pass, as entered: finished goods (product_id, in pcs or
-- dz) or anything else as free text.
-- p_lines: [{ "product_id": uuid|null, "description": text, "uom": text, "quantity": n, "remarks": text }]
CREATE OR REPLACE FUNCTION public.gate_pass_build_sample(p_id uuid, p_lines jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_line jsonb;
  v_no integer := 0;
  v_qty numeric;
  v_uom text;
  v_desc text;
  v_product uuid;
BEGIN
  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  FOR v_line IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_qty := NULLIF(v_line->>'quantity', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Every line needs a quantity greater than zero.';
    END IF;
    v_product := NULLIF(v_line->>'product_id', '')::uuid;
    v_uom := NULLIF(btrim(v_line->>'uom'), '');
    IF v_product IS NOT NULL THEN
      SELECT p.code || ' · ' || p.name INTO v_desc FROM public.products p WHERE p.id = v_product;
      IF v_desc IS NULL THEN
        RAISE EXCEPTION 'A selected product no longer exists.';
      END IF;
      v_uom := COALESCE(v_uom, 'pcs');
      IF v_uom NOT IN ('pcs','dz') THEN
        RAISE EXCEPTION 'Finished-goods samples are counted in pcs or dz.';
      END IF;
    ELSE
      v_desc := NULLIF(btrim(v_line->>'description'), '');
      IF v_desc IS NULL THEN
        RAISE EXCEPTION 'Describe every line that is not a product.';
      END IF;
      v_uom := COALESCE(v_uom, 'pcs');
    END IF;
    v_no := v_no + 1;
    INSERT INTO public.gate_pass_items
      (gate_pass_id, line_no, product_id, description, uom, quantity, count_basis, remarks)
    VALUES (p_id, v_no, v_product, v_desc, v_uom, v_qty, 'quantity',
            NULLIF(btrim(v_line->>'remarks'), ''));
  END LOOP;
  IF v_no = 0 THEN
    RAISE EXCEPTION 'Add at least one line.';
  END IF;
END;
$$;

-- 5. Write functions ---------------------------------------------------------

-- Create (p_id NULL) or update a draft, and optionally submit it.
-- p_data: {
--   pass_type: 'sales' | 'sample' | 'supplier_return',
--   pass_date, vehicle_number, driver_name, driver_contact, transporter_name, remarks,
--   dispatch_ids: [uuid]                          -- sales
--   purchase_return_id: uuid                      -- supplier_return
--   party_kind, party_id, party_name, lines: [..] -- sample
-- }
CREATE OR REPLACE FUNCTION public.gate_pass_save(p_id uuid, p_data jsonb, p_submit boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_type text := p_data->>'pass_type';
  v_old public.gate_passes%ROWTYPE;
  v_id uuid := p_id;
  v_party_name text;
  v_party_id uuid;
  v_party_kind text;
  v_ids uuid[];
  v_vehicle text := NULLIF(btrim(p_data->>'vehicle_number'), '');
  v_remarks text := NULLIF(btrim(p_data->>'remarks'), '');
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to make gate passes.';
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('sales','sample','supplier_return') THEN
    RAISE EXCEPTION 'Choose Sales, Sample or Supplier return. The other pass types are not available yet.';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.gate_passes WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate pass not found.';
    END IF;
    IF v_old.status <> 'draft' THEN
      RAISE EXCEPTION 'Gate pass % is % and can no longer be edited.', v_old.pass_number, replace(v_old.status, '_', ' ');
    END IF;
    IF v_old.pass_type <> v_type THEN
      RAISE EXCEPTION 'The type of a saved pass cannot be changed. Cancel it and make a new one.';
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid AND NOT public.gate_pass_can('approve') THEN
      RAISE EXCEPTION 'Only the person who made this draft or a manager can edit it.';
    END IF;
  ELSE
    -- A placeholder number until every check below has passed, so a failed
    -- save never uses up a GP number and the series stays without gaps.
    INSERT INTO public.gate_passes (pass_number, pass_type, party_name, created_by)
    VALUES ('NEW-' || gen_random_uuid()::text, v_type, '—', v_uid)
    RETURNING id INTO v_id;
  END IF;

  IF v_type = 'sales' THEN
    IF v_vehicle IS NULL THEN
      RAISE EXCEPTION 'Enter the vehicle number.';
    END IF;
    SELECT array_agg(DISTINCT x::uuid) INTO v_ids
      FROM jsonb_array_elements_text(COALESCE(p_data->'dispatch_ids', '[]'::jsonb)) x;
    SELECT b.party_name, b.party_id INTO v_party_name, v_party_id
      FROM public.gate_pass_build_sales(v_id, v_ids) b;
    v_party_kind := 'customer';
  ELSIF v_type = 'supplier_return' THEN
    SELECT b.party_name, b.party_id INTO v_party_name, v_party_id
      FROM public.gate_pass_build_supplier_return(v_id, NULLIF(p_data->>'purchase_return_id', '')::uuid) b;
    v_party_kind := 'supplier';
  ELSE
    v_party_kind := COALESCE(NULLIF(p_data->>'party_kind', ''), 'other');
    v_party_id := NULLIF(p_data->>'party_id', '')::uuid;
    IF v_party_kind = 'customer' AND v_party_id IS NOT NULL THEN
      SELECT name INTO v_party_name FROM public.customers WHERE id = v_party_id;
    ELSIF v_party_kind = 'distributor' AND v_party_id IS NOT NULL THEN
      SELECT name INTO v_party_name FROM public.distributors WHERE id = v_party_id;
    ELSIF v_party_kind = 'other' THEN
      v_party_id := NULL;
      v_party_name := NULLIF(btrim(p_data->>'party_name'), '');
    ELSE
      RAISE EXCEPTION 'Choose who the samples are going to.';
    END IF;
    IF v_party_name IS NULL THEN
      RAISE EXCEPTION 'Choose who the samples are going to.';
    END IF;
    IF v_remarks IS NULL THEN
      RAISE EXCEPTION 'Give the reason for these samples.';
    END IF;
    PERFORM public.gate_pass_build_sample(v_id, p_data->'lines');
  END IF;

  UPDATE public.gate_passes
     SET pass_date = COALESCE(NULLIF(p_data->>'pass_date', '')::date, pass_date),
         party_kind = v_party_kind,
         party_id = v_party_id,
         party_name = v_party_name,
         vehicle_number = v_vehicle,
         driver_name = NULLIF(btrim(p_data->>'driver_name'), ''),
         driver_contact = NULLIF(btrim(p_data->>'driver_contact'), ''),
         transporter_name = NULLIF(btrim(p_data->>'transporter_name'), ''),
         purchase_return_id = CASE WHEN v_type = 'supplier_return'
                                   THEN NULLIF(p_data->>'purchase_return_id', '')::uuid END,
         remarks = v_remarks,
         pass_number = CASE WHEN p_id IS NULL
                            THEN 'GP-' || lpad(nextval('public.gate_pass_number_seq')::text, 6, '0')
                            ELSE pass_number END,
         updated_at = now()
   WHERE id = v_id;

  PERFORM public.gate_pass_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END);

  IF p_submit THEN
    PERFORM public.gate_pass_submit(v_id);
  END IF;
  RETURN v_id;
END;
$$;

-- Send a draft on: sales and supplier returns are approved automatically
-- (their sales orders / purchase return are already approved); samples wait
-- for a manager. Returns the new status.
CREATE OR REPLACE FUNCTION public.gate_pass_submit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_ids uuid[];
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to submit gate passes.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status <> 'draft' THEN
    RAISE EXCEPTION 'Gate pass % is already %.', g.pass_number, replace(g.status, '_', ' ');
  END IF;

  -- Re-check the source documents: they may have changed since the draft.
  IF g.pass_type = 'sales' THEN
    SELECT array_agg(dispatch_id) INTO v_ids FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id;
    PERFORM public.gate_pass_build_sales(p_id, v_ids);
  ELSIF g.pass_type = 'supplier_return' THEN
    PERFORM public.gate_pass_build_supplier_return(p_id, g.purchase_return_id);
  ELSIF NOT EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one line.';
  END IF;

  IF g.pass_type IN ('sales','supplier_return') THEN
    UPDATE public.gate_passes
       SET status = 'approved', submitted_at = now(), approved_at = now(), approved_by = NULL,
           approval_remarks = CASE g.pass_type
             WHEN 'sales' THEN 'Approved automatically: the sales orders are approved.'
             ELSE 'Approved automatically: goes back on a purchase return.' END,
           updated_at = now()
     WHERE id = p_id;
    PERFORM public.gate_pass_log(p_id, 'approved', 'Approved automatically');
    RETURN 'approved';
  END IF;

  UPDATE public.gate_passes
     SET status = 'pending_approval', submitted_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_log(p_id, 'submitted', 'Sent for approval');
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  PERFORM public.gate_pass_notify(g, 'Gate pass needs approval',
    g.pass_number || ' · ' || initcap(replace(g.pass_type, '_', ' ')) || ' for ' || g.party_name,
    'info', false, true);
  RETURN 'pending_approval';
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_review(p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF NOT public.gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only a gate pass manager can approve or reject passes.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Gate pass % is not waiting for approval.', g.pass_number;
  END IF;
  IF NOT p_approve AND NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the pass.';
  END IF;

  UPDATE public.gate_passes
     SET status = v_status, approved_by = public.app_user_id(), approved_at = now(),
         approval_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, v_status, NULLIF(btrim(p_remarks), ''));
  PERFORM public.gate_pass_notify(g,
    'Gate pass ' || v_status,
    g.pass_number || ' for ' || g.party_name || COALESCE(': ' || NULLIF(btrim(p_remarks), ''), ''),
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END, true, false);
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status NOT IN ('draft','pending_approval','approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % and cannot be cancelled.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF NOT (public.gate_pass_can('approve')
          OR (public.gate_pass_can('create') AND g.created_by = v_uid
              AND g.status IN ('draft','pending_approval'))) THEN
    RAISE EXCEPTION 'Only a gate pass manager can cancel this pass.';
  END IF;
  IF g.status <> 'draft' AND NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the pass.';
  END IF;

  UPDATE public.gate_passes
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
         cancel_reason = NULLIF(btrim(p_reason), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'cancelled', NULLIF(btrim(p_reason), ''));
  IF g.approved_at IS NOT NULL OR g.held_at IS NOT NULL THEN
    PERFORM public.gate_pass_notify(g, 'Gate pass cancelled',
      g.pass_number || ' for ' || g.party_name || COALESCE(': ' || NULLIF(btrim(p_reason), ''), ''),
      'warning', true, false);
  END IF;
END;
$$;

-- Take one dispatch off a sales pass that has not gone out (e.g. the truck
-- leaves without it). The last dispatch cannot be removed: cancel instead.
CREATE OR REPLACE FUNCTION public.gate_pass_remove_dispatch(p_id uuid, p_dispatch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_no text;
BEGIN
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.pass_type <> 'sales' THEN
    RAISE EXCEPTION 'Only a sales pass has dispatches.';
  END IF;
  IF g.status NOT IN ('draft','approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % and cannot be changed.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF NOT (public.gate_pass_can('approve')
          OR (g.status = 'draft' AND public.gate_pass_can('create') AND g.created_by = public.app_user_id())) THEN
    RAISE EXCEPTION 'Only a gate pass manager can take a dispatch off this pass.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id AND dispatch_id = p_dispatch_id) THEN
    RAISE EXCEPTION 'That dispatch is not on this pass.';
  END IF;
  IF (SELECT count(*) FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id) = 1 THEN
    RAISE EXCEPTION 'This is the only dispatch on the pass. Cancel the pass instead.';
  END IF;

  SELECT dispatch_number INTO v_no FROM public.sales_dispatches WHERE id = p_dispatch_id;
  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id AND dispatch_id = p_dispatch_id;
  DELETE FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id AND dispatch_id = p_dispatch_id;
  UPDATE public.gate_pass_items i
     SET line_no = n.rn
    FROM (SELECT id, row_number() OVER (ORDER BY line_no) AS rn
            FROM public.gate_pass_items WHERE gate_pass_id = p_id) n
   WHERE i.id = n.id;
  UPDATE public.gate_passes
     SET party_name = COALESCE((
           SELECT string_agg(DISTINCT cu.name, '; ')
             FROM public.gate_pass_dispatches gd
             JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
             JOIN public.sales_orders so
               ON so.id = sd.order_id
               OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)
             JOIN public.customers cu ON cu.id = so.customer_id
            WHERE gd.gate_pass_id = p_id), party_name),
         updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_log(p_id, 'dispatch_removed', v_no, jsonb_build_object('dispatch_id', p_dispatch_id));
END;
$$;

-- Office action on a sales pass whose dispatch was edited after the pass was
-- made: re-read the dispatches. Returns how many lines changed.
CREATE OR REPLACE FUNCTION public.gate_pass_refresh(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_n integer;
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to change gate passes.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.pass_type <> 'sales' THEN
    RAISE EXCEPTION 'Only a sales pass can be refreshed from its dispatches.';
  END IF;
  IF g.status NOT IN ('draft','approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % and cannot be changed.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  v_n := public.gate_pass_sync_sales(p_id);
  IF v_n > 0 THEN
    PERFORM public.gate_pass_log(p_id, 'refreshed', v_n || ' line(s) updated from the dispatches');
  END IF;
  RETURN v_n;
END;
$$;

-- The vehicle leaves: status Out, stock posted for samples, dispatches set to
-- In Transit. Internal — called by the gate check and by a manager's release.
CREATE OR REPLACE FUNCTION public.gate_pass_mark_out(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
BEGIN
  UPDATE public.gate_passes
     SET status = 'out', gate_out_by = v_uid, gate_out_at = now(), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;

  IF g.pass_type = 'sample' THEN
    INSERT INTO public.stock_movements
      (movement_number, movement_type, movement_date, item_type, item_id, quantity,
       reference_type, reference_id, reference_number, remarks, status, created_by)
    SELECT '', 'issue', (g.gate_out_at AT TIME ZONE 'Asia/Karachi')::date, 'finished_goods', i.product_id,
           CASE i.uom WHEN 'pcs' THEN i.quantity / 12 ELSE i.quantity END,
           'gate_pass', g.id, g.pass_number,
           'Sample to ' || g.party_name || ' (' || i.quantity || ' ' || i.uom || ')',
           'completed', v_uid
      FROM public.gate_pass_items i
     WHERE i.gate_pass_id = g.id AND i.product_id IS NOT NULL AND i.quantity > 0;
  ELSIF g.pass_type = 'sales' THEN
    UPDATE public.sales_dispatches sd
       SET delivery_status = 'in_transit'
      FROM public.gate_pass_dispatches gd
     WHERE gd.gate_pass_id = g.id AND sd.id = gd.dispatch_id AND sd.delivery_status = 'pending';
  END IF;

  PERFORM public.gate_pass_log(p_id, 'out', 'Vehicle left the gate');
END;
$$;

-- The guard's check. p_counts: [{ "item_id": uuid, "counted": n }] — one per
-- line. Everything equal (and the vehicle matches) → Out. Otherwise → Held and
-- the pass maker + managers are told. Returns
-- { status, mismatches: [{ line_no, description, expected, counted }], vehicle_ok }.
CREATE OR REPLACE FUNCTION public.gate_pass_gate_check(
  p_id uuid, p_counts jsonb, p_vehicle text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  v_missing integer;
  v_mismatch jsonb;
  v_vehicle_ok boolean;
  v_changed text;
BEGIN
  IF NOT public.gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can check passes at the gate.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status = 'out' THEN
    RAISE EXCEPTION 'Gate pass % has already gone out.', g.pass_number;
  END IF;
  IF g.status NOT IN ('approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % — it cannot leave yet.', g.pass_number, replace(g.status, '_', ' ');
  END IF;

  -- A sales pass must still match its dispatches, or the guard would be
  -- counting against stale figures.
  IF g.pass_type = 'sales' THEN
    SELECT string_agg(DISTINCT sd.dispatch_number, ', ') INTO v_changed
      FROM public.gate_pass_items i
      JOIN public.sales_dispatches sd ON sd.id = i.dispatch_id
      LEFT JOIN public.sales_dispatch_items di ON di.id = i.dispatch_item_id
     WHERE i.gate_pass_id = p_id AND i.quantity > 0
       AND (di.id IS NULL OR di.quantity_dozens IS DISTINCT FROM i.quantity
            OR di.packages IS DISTINCT FROM i.packages);
    IF v_changed IS NOT NULL THEN
      RAISE EXCEPTION 'Dispatch % was changed after this pass was made. Ask the office to refresh the pass.', v_changed;
    END IF;
  END IF;

  UPDATE public.gate_pass_items i
     SET counted = c.counted, counted_by = v_uid, counted_at = now()
    FROM (SELECT (x->>'item_id')::uuid AS item_id, NULLIF(x->>'counted', '')::numeric AS counted
            FROM jsonb_array_elements(COALESCE(p_counts, '[]'::jsonb)) x) c
   WHERE i.gate_pass_id = p_id AND i.id = c.item_id AND c.counted IS NOT NULL AND c.counted >= 0;

  SELECT count(*) INTO v_missing
    FROM public.gate_pass_items i
   WHERE i.gate_pass_id = p_id AND i.quantity > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_counts, '[]'::jsonb)) x
                      WHERE (x->>'item_id')::uuid = i.id
                        AND NULLIF(x->>'counted', '')::numeric >= 0);
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Count every line before continuing (% not counted).', v_missing;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'item_id', i.id, 'line_no', i.line_no, 'description', i.description,
           'count_basis', i.count_basis, 'expected', public.gate_pass_expected(i), 'counted', i.counted)
         ORDER BY i.line_no), '[]'::jsonb)
    INTO v_mismatch
    FROM public.gate_pass_items i
   WHERE i.gate_pass_id = p_id AND i.quantity > 0 AND i.counted <> public.gate_pass_expected(i);

  v_vehicle_ok := public.gate_pass_norm_vehicle(g.vehicle_number) IS NULL
               OR public.gate_pass_norm_vehicle(g.vehicle_number) = public.gate_pass_norm_vehicle(p_vehicle);

  UPDATE public.gate_passes SET gate_vehicle_number = NULLIF(btrim(p_vehicle), '') WHERE id = p_id;

  IF jsonb_array_length(v_mismatch) = 0 AND v_vehicle_ok THEN
    PERFORM public.gate_pass_mark_out(p_id);
    RETURN jsonb_build_object('status', 'out', 'mismatches', v_mismatch, 'vehicle_ok', true);
  END IF;

  UPDATE public.gate_passes
     SET status = 'held', held_by = v_uid, held_at = now(),
         hold_note = NULLIF(btrim(p_note), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'held', NULLIF(btrim(p_note), ''),
    jsonb_build_object('mismatches', v_mismatch, 'vehicle_ok', v_vehicle_ok,
                       'gate_vehicle', NULLIF(btrim(p_vehicle), '')));
  PERFORM public.gate_pass_notify(g, 'Vehicle held at gate',
    g.pass_number || ' for ' || g.party_name || ': '
      || CASE WHEN NOT v_vehicle_ok THEN 'vehicle number does not match' ELSE '' END
      || CASE WHEN NOT v_vehicle_ok AND jsonb_array_length(v_mismatch) > 0 THEN '; ' ELSE '' END
      || CASE WHEN jsonb_array_length(v_mismatch) > 0
              THEN jsonb_array_length(v_mismatch) || ' line(s) do not match the count' ELSE '' END
      || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''),
    'warning', true, true);
  RETURN jsonb_build_object('status', 'held', 'mismatches', v_mismatch, 'vehicle_ok', v_vehicle_ok);
END;
$$;

-- A manager lets a held pass go with what the guard counted. Allowed only
-- when nothing is over the pass. Sales: the dispatch must already have been
-- corrected to the count (the pass is re-read from it first). Other types: the
-- lines are cut down to the count. The vehicle then goes out.
CREATE OR REPLACE FUNCTION public.gate_pass_release(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  v_bad text;
  v_before jsonb;
BEGIN
  IF NOT public.gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only a gate pass manager can release a held pass.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason for releasing with the counted quantity.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status <> 'held' THEN
    RAISE EXCEPTION 'Gate pass % is not held at the gate.', g.pass_number;
  END IF;
  IF public.gate_pass_norm_vehicle(g.vehicle_number) IS NOT NULL
     AND public.gate_pass_norm_vehicle(g.vehicle_number)
         IS DISTINCT FROM public.gate_pass_norm_vehicle(g.gate_vehicle_number) THEN
    RAISE EXCEPTION 'The vehicle at the gate (%) is not the one on the pass (%). Cancel this pass and make a new one for the right vehicle.',
      COALESCE(g.gate_vehicle_number, 'none entered'), g.vehicle_number;
  END IF;

  SELECT string_agg(i.description || ': pass ' || public.gate_pass_expected(i) || ', counted ' || i.counted, '; ')
    INTO v_bad
    FROM public.gate_pass_items i
   WHERE i.gate_pass_id = p_id AND i.quantity > 0 AND i.counted > public.gate_pass_expected(i);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'More goods were counted than the pass allows (%). Unload the extra and have the guard count again, or cancel and make a new pass.', v_bad;
  END IF;

  SELECT jsonb_agg(jsonb_build_object('line_no', line_no, 'description', description,
                                      'quantity', quantity, 'packages', packages, 'counted', counted)
                   ORDER BY line_no)
    INTO v_before FROM public.gate_pass_items WHERE gate_pass_id = p_id;

  IF g.pass_type = 'sales' THEN
    PERFORM public.gate_pass_sync_sales(p_id);
    SELECT string_agg(sd.dispatch_number || ' ' || i.description
                      || ': dispatch ' || public.gate_pass_expected(i) || ', counted ' || COALESCE(i.counted, 0), '; ')
      INTO v_bad
      FROM public.gate_pass_items i
      JOIN public.sales_dispatches sd ON sd.id = i.dispatch_id
     WHERE i.gate_pass_id = p_id
       AND public.gate_pass_expected(i) <> COALESCE(i.counted, 0);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'Correct the dispatch to what was counted first (%), or take that dispatch off the pass.', v_bad;
    END IF;
  ELSE
    UPDATE public.gate_pass_items i
       SET original_quantity = COALESCE(i.original_quantity, i.quantity),
           quantity = i.counted
     WHERE i.gate_pass_id = p_id AND i.counted IS NOT NULL AND i.counted < i.quantity;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id AND quantity > 0) THEN
    RAISE EXCEPTION 'Nothing is left on the pass. Cancel it instead.';
  END IF;

  UPDATE public.gate_passes
     SET released_by = v_uid, released_at = now(), release_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_log(p_id, 'released', btrim(p_reason), jsonb_build_object('before', v_before));
  PERFORM public.gate_pass_mark_out(p_id);
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  PERFORM public.gate_pass_notify(g, 'Held pass released',
    g.pass_number || ' for ' || g.party_name || ' left with the counted quantity: ' || btrim(p_reason),
    'info', true, false);
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.gate_pass_has_any_role(text[]),
  public.gate_pass_can(text),
  public.gate_pass_norm_vehicle(text),
  public.gate_pass_expected(public.gate_pass_items),
  public.gate_pass_save(uuid, jsonb, boolean),
  public.gate_pass_submit(uuid),
  public.gate_pass_review(uuid, boolean, text),
  public.gate_pass_cancel(uuid, text),
  public.gate_pass_remove_dispatch(uuid, uuid),
  public.gate_pass_refresh(uuid),
  public.gate_pass_gate_check(uuid, jsonb, text, text),
  public.gate_pass_release(uuid, text)
TO anon, authenticated, service_role;

-- Internal building blocks: only callable from the functions above.
REVOKE EXECUTE ON FUNCTION
  public.gate_pass_log(uuid, text, text, jsonb),
  public.gate_pass_notify(public.gate_passes, text, text, text, boolean, boolean),
  public.gate_pass_build_sales(uuid, uuid[]),
  public.gate_pass_sync_sales(uuid),
  public.gate_pass_build_supplier_return(uuid, uuid),
  public.gate_pass_build_sample(uuid, jsonb),
  public.gate_pass_mark_out(uuid)
FROM PUBLIC, anon, authenticated;
