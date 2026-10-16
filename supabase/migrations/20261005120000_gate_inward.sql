-- ============================================================================
-- Gate Inward — Phase 1: Purchase, Returnable back, Job work back
-- ----------------------------------------------------------------------------
-- The security gate's record of every vehicle that brings goods INTO the
-- factory, made before anything reaches the store. One number series for all
-- types: GIN-000001, GIN-000002 … (given only when the entry saves, so failed
-- saves never leave gaps — same as GP-).
--
-- The guard records the MOVEMENT, not the goods: who came, on what vehicle,
-- against which PO or outward pass, when, with a photo of the challan. There
-- are no quantities and no line table at the gate. Quantities stay where they
-- are today: the GRN (purchase) and the GPR- receipt (returnable / job work).
--
--   purchase          A delivery against one approved / ordered / partially
--                     received PO of the supplier, in the categories allowed by
--                     gate_inward_settings.purchase_categories (raw material by
--                     default). Closed when the GRN for that PO names the entry
--                     (goods_receipt_notes.gate_inward_id) → grn_made.
--   returnable_return Goods coming back on a Returnable outward pass that is
--                     out / partly returned. Closed when "Receive goods" on the
--                     pass names the entry (gate_inward_attach_receipt) → received.
--   job_work_return   Same for a Job work pass.
--   sales_return, sample, loading_vehicle, other
--                     Allowed by the CHECK constraints and the settings row, but
--                     not enabled by default: Phase 2.
--
-- Flow: at_gate → grn_made | received | closed | loaded_out
--               ↘ rejected (office: vehicle turned away)
--               ↘ cancelled (office, or the guard who made it: made by mistake)
-- vehicle_out_at: the guard taps "Vehicle left" when the empty truck goes out.
--
-- Gate Inward never moves stock or money. It does not insert GRNs, does not
-- touch purchase_order_items.quantity_received, does not post vouchers. QC and
-- GRN stay exactly as they are; a GRN can simply NAME the entry it receives
-- against. Requiring that (require_for_grn) is OFF by default: switch it on per
-- category once the gate is trained.
--
-- All tables are read-only to clients: writes go through the SECURITY DEFINER
-- functions below, which check the acting user's role via app_user_id(). No new
-- roles: gate_security / gate_pass_manager make entries ("gate"); purchase
-- officers and managers run the register ("office"); store_operator reads it.
-- The guard never sees prices or quantities: the PO and pass pickers are
-- functions that return headers only.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.gate_inward_number_seq;

CREATE TABLE IF NOT EXISTS public.gate_inward_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number text NOT NULL UNIQUE,
  entry_kind text NOT NULL DEFAULT 'purchase'
    CHECK (entry_kind IN ('purchase','returnable_return','job_work_return',
                          'sales_return','sample','loading_vehicle','other')),
  status text NOT NULL DEFAULT 'at_gate'
    CHECK (status IN ('at_gate','grn_made','received','closed','loaded_out','rejected','cancelled')),
  entry_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Karachi')::date,
  in_at timestamptz NOT NULL DEFAULT now(),
  -- party and the record this entry arrives against (by type)
  supplier_id uuid REFERENCES public.suppliers(id),          -- purchase, sample
  customer_id uuid REFERENCES public.customers(id),          -- sales_return, loading_vehicle
  party_name text NOT NULL,                                  -- snapshot / free text
  purchase_order_id uuid REFERENCES public.purchase_orders(id),   -- purchase
  gate_pass_id uuid REFERENCES public.gate_passes(id),            -- returnable_return, job_work_return
  dispatch_id uuid REFERENCES public.sales_dispatches(id),        -- sales_return (optional)
  -- vehicle and documents
  vehicle_number text NOT NULL,
  driver_name text,
  driver_contact text,
  transporter_name text,
  challan_number text,
  challan_date date,
  packages_count integer CHECK (packages_count IS NULL OR packages_count >= 0),
  gross_weight_kg numeric CHECK (gross_weight_kg IS NULL OR gross_weight_kg >= 0),
  challan_photo_path text,
  vehicle_photo_path text,
  remarks text,
  -- lifecycle
  created_by uuid NOT NULL REFERENCES public.app_users(id),
  vehicle_out_at timestamptz,
  vehicle_out_by uuid REFERENCES public.app_users(id),
  -- what closed it (by type)
  grn_id uuid REFERENCES public.goods_receipt_notes(id) ON DELETE SET NULL,
  gate_pass_receipt_id uuid REFERENCES public.gate_pass_receipts(id) ON DELETE SET NULL,
  sales_return_id uuid REFERENCES public.sales_returns(id) ON DELETE SET NULL,
  out_gate_pass_id uuid REFERENCES public.gate_passes(id) ON DELETE SET NULL,
  closed_by uuid REFERENCES public.app_users(id),
  closed_at timestamptz,
  close_note text,
  rejected_by uuid REFERENCES public.app_users(id),
  rejected_at timestamptz,
  reject_reason text,
  cancelled_by uuid REFERENCES public.app_users(id),
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (entry_kind <> 'purchase' OR (supplier_id IS NOT NULL AND purchase_order_id IS NOT NULL)),
  CHECK (entry_kind NOT IN ('returnable_return','job_work_return') OR gate_pass_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS gate_inward_entries_date_idx ON public.gate_inward_entries (entry_date DESC, in_at DESC);
CREATE INDEX IF NOT EXISTS gate_inward_entries_status_idx ON public.gate_inward_entries (status) WHERE status = 'at_gate';
CREATE INDEX IF NOT EXISTS gate_inward_entries_po_idx ON public.gate_inward_entries (purchase_order_id) WHERE purchase_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gate_inward_entries_pass_idx ON public.gate_inward_entries (gate_pass_id) WHERE gate_pass_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.gate_inward_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.gate_inward_entries(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_inward_events_entry_idx ON public.gate_inward_events (entry_id, created_at);

-- Single row of settings (super admin).
CREATE TABLE IF NOT EXISTS public.gate_inward_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  require_for_grn boolean NOT NULL DEFAULT false,
  require_for_categories public.purchase_category[] NOT NULL DEFAULT '{raw_material}',
  purchase_categories public.purchase_category[] NOT NULL DEFAULT '{raw_material}',
  enabled_kinds text[] NOT NULL DEFAULT '{purchase,returnable_return,job_work_return}',
  stale_days integer NOT NULL DEFAULT 3 CHECK (stale_days >= 1),
  updated_by uuid REFERENCES public.app_users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.gate_inward_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- The closing records point back at the entry (one entry per record).
ALTER TABLE public.goods_receipt_notes
  ADD COLUMN IF NOT EXISTS gate_inward_id uuid REFERENCES public.gate_inward_entries(id);
CREATE UNIQUE INDEX IF NOT EXISTS goods_receipt_notes_gate_inward_idx
  ON public.goods_receipt_notes (gate_inward_id) WHERE gate_inward_id IS NOT NULL;
ALTER TABLE public.gate_pass_receipts
  ADD COLUMN IF NOT EXISTS gate_inward_id uuid REFERENCES public.gate_inward_entries(id);
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_receipts_gate_inward_idx
  ON public.gate_pass_receipts (gate_inward_id) WHERE gate_inward_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_gate_inward_entries_updated_at ON public.gate_inward_entries;
CREATE TRIGGER update_gate_inward_entries_updated_at
  BEFORE UPDATE ON public.gate_inward_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Audit trail like the other purchase tables.
DROP TRIGGER IF EXISTS audit_row_change ON public.gate_inward_entries;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.gate_inward_entries
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('purchase');

-- Read-only to clients: SELECT policies only, so every write goes through the
-- role-checked functions below. Nothing commercial is stored here.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gate_inward_entries','gate_inward_events','gate_inward_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Views -------------------------------------------------------------------

-- The register: one row per entry with the names and numbers the pages show.
CREATE OR REPLACE VIEW public.v_gate_inward_register AS
SELECT e.*,
       s.name AS supplier_name, s.code AS supplier_code,
       po.po_number, po.category AS po_category, po.status AS po_status,
       gp.pass_number, gp.pass_type, gp.expected_return_date,
       grn.grn_number, grn.receipt_date AS grn_date,
       gpr.receipt_number, gpr.receipt_date,
       cu.full_name AS created_by_name,
       vo.full_name AS vehicle_out_by_name,
       GREATEST(0, (now() AT TIME ZONE 'Asia/Karachi')::date - e.entry_date) AS age_days,
       (e.status = 'at_gate'
        AND (now() AT TIME ZONE 'Asia/Karachi')::date - e.entry_date
            >= (SELECT stale_days FROM public.gate_inward_settings WHERE id)) AS is_stale
  FROM public.gate_inward_entries e
  LEFT JOIN public.suppliers s ON s.id = e.supplier_id
  LEFT JOIN public.purchase_orders po ON po.id = e.purchase_order_id
  LEFT JOIN public.gate_passes gp ON gp.id = e.gate_pass_id
  LEFT JOIN public.goods_receipt_notes grn ON grn.id = e.grn_id
  LEFT JOIN public.gate_pass_receipts gpr ON gpr.id = e.gate_pass_receipt_id
  LEFT JOIN public.app_users cu ON cu.id = e.created_by
  LEFT JOIN public.app_users vo ON vo.id = e.vehicle_out_by;

-- Per PO: vehicles arrived and not yet received, and those received.
CREATE OR REPLACE VIEW public.v_purchase_order_gate_inward AS
SELECT purchase_order_id,
       count(*) FILTER (WHERE status = 'at_gate') AS at_gate_count,
       count(*) FILTER (WHERE status = 'grn_made') AS received_count,
       max(in_at) FILTER (WHERE status = 'at_gate') AS last_at_gate_at
  FROM public.gate_inward_entries
 WHERE purchase_order_id IS NOT NULL
 GROUP BY purchase_order_id;

GRANT SELECT ON public.v_gate_inward_register, public.v_purchase_order_gate_inward
  TO anon, authenticated, service_role;

-- 3. Helpers -----------------------------------------------------------------

-- gate   → make entries, Vehicle left, open an entry by number
-- office → register, reject / cancel / close, link the GRN or receipt
CREATE OR REPLACE FUNCTION public.gate_inward_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'gate'   THEN ARRAY['super_admin','gate_pass_manager','gate_security']
    WHEN 'office' THEN ARRAY['super_admin','admin','purchase_manager','purchase_officer','gate_pass_manager']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.gate_inward_log(
  p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.gate_inward_events (entry_id, event, message, details, created_by)
  VALUES (p_id, p_event, p_message, p_details, public.app_user_id());
$$;

-- Notify the office (purchase officers and managers, the store, super admins)
-- and / or the guard who made the entry. Never the actor. Module 'purchase';
-- the office link opens the register's entry page, the guard's link the gate one.
CREATE OR REPLACE FUNCTION public.gate_inward_notify(
  p_entry public.gate_inward_entries, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_office boolean DEFAULT true, p_to_maker boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
BEGIN
  IF p_to_office THEN
    PERFORM public.notify_role(
      ARRAY['super_admin','purchase_manager','purchase_officer','store_operator']::app_role[],
      p_title, p_message, p_type, 'purchase',
      '/purchase/gate-inward/' || p_entry.id::text, 'gate_inward', p_entry.id, v_uid, v_uid);
  END IF;
  IF p_to_maker AND p_entry.created_by IS DISTINCT FROM v_uid
     AND NOT (p_to_office AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = p_entry.created_by
          AND role::text IN ('super_admin','purchase_manager','purchase_officer','store_operator'))) THEN
    PERFORM public.notify_user(p_entry.created_by, p_title, p_message, p_type, 'purchase',
      '/gate-pass/inward/' || p_entry.id::text, 'gate_inward', p_entry.id, v_uid);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_inward_kind_label(p_kind text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_kind
    WHEN 'purchase' THEN 'Purchase'
    WHEN 'returnable_return' THEN 'Returnable back'
    WHEN 'job_work_return' THEN 'Job work back'
    WHEN 'sales_return' THEN 'Sales return'
    WHEN 'sample' THEN 'Sample / free supply'
    WHEN 'loading_vehicle' THEN 'Empty vehicle for loading'
    ELSE 'Other' END;
$$;

-- 4. Pickers for the guard (headers only: no amounts, no quantities) ---------

-- POs of a supplier that can still receive something, in the allowed categories.
CREATE OR REPLACE FUNCTION public.gate_inward_open_pos(p_supplier_id uuid)
RETURNS TABLE (
  id uuid, po_number text, order_date date, expected_date date,
  category text, status text, at_gate_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT po.id, po.po_number::text, po.order_date::date, po.expected_date::date,
         po.category::text, po.status::text,
         (SELECT count(*) FROM public.gate_inward_entries e
           WHERE e.purchase_order_id = po.id AND e.status = 'at_gate') AS at_gate_count
    FROM public.purchase_orders po
   CROSS JOIN public.gate_inward_settings s
   WHERE (public.gate_inward_can('gate') OR public.gate_inward_can('office'))
     AND po.supplier_id = p_supplier_id
     AND po.status IN ('approved','ordered','partially_received')
     AND po.closed_short_at IS NULL
     AND po.category = ANY (s.purchase_categories)
     AND EXISTS (SELECT 1 FROM public.purchase_order_items i
                  WHERE i.order_id = po.id AND i.quantity > COALESCE(i.quantity_received, 0))
   ORDER BY po.order_date DESC, po.po_number DESC;
$$;

-- Suppliers that have such a PO, so the guard's supplier list is short.
CREATE OR REPLACE FUNCTION public.gate_inward_suppliers()
RETURNS TABLE (id uuid, name text, code text, open_po_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT s.id, s.name::text, s.code::text, count(po.id) AS open_po_count
    FROM public.suppliers s
    JOIN public.purchase_orders po ON po.supplier_id = s.id
   CROSS JOIN public.gate_inward_settings st
   WHERE (public.gate_inward_can('gate') OR public.gate_inward_can('office'))
     AND po.status IN ('approved','ordered','partially_received')
     AND po.closed_short_at IS NULL
     AND po.category = ANY (st.purchase_categories)
     AND EXISTS (SELECT 1 FROM public.purchase_order_items i
                  WHERE i.order_id = po.id AND i.quantity > COALESCE(i.quantity_received, 0))
   GROUP BY s.id, s.name, s.code
   ORDER BY s.name;
$$;

-- Returnable / job-work passes still outside, by exact number or party search.
CREATE OR REPLACE FUNCTION public.gate_inward_open_passes(p_search text DEFAULT NULL)
RETURNS TABLE (
  id uuid, pass_number text, pass_type text, status text, party_name text,
  vehicle_number text, driver_name text, process_name text, expected_return_date date,
  gate_out_at timestamptz, at_gate_count bigint
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT g.id, g.pass_number, g.pass_type, g.status, g.party_name,
         g.vehicle_number, g.driver_name, g.process_name, g.expected_return_date, g.gate_out_at,
         (SELECT count(*) FROM public.gate_inward_entries e
           WHERE e.gate_pass_id = g.id AND e.status = 'at_gate') AS at_gate_count
    FROM public.gate_passes g
   WHERE (public.gate_inward_can('gate') OR public.gate_inward_can('office'))
     AND g.pass_type IN ('returnable','job_work')
     AND g.status IN ('out','partially_returned')
     AND (NULLIF(btrim(p_search), '') IS NULL
          OR g.pass_number = upper(btrim(p_search))
          OR g.party_name ILIKE '%' || btrim(p_search) || '%')
   ORDER BY g.expected_return_date NULLS LAST, g.pass_number
   LIMIT 50;
$$;

-- 5. Writes ------------------------------------------------------------------

-- p_data: { entry_kind, supplier_id, purchase_order_id, gate_pass_id, customer_id,
--           dispatch_id, party_name, vehicle_number, driver_name, driver_contact,
--           transporter_name, challan_number, challan_date, packages_count,
--           gross_weight_kg, challan_photo_path, vehicle_photo_path, remarks }
-- Insert (p_id null) or edit while at_gate (the maker or the office).
CREATE OR REPLACE FUNCTION public.gate_inward_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_kind text := p_data->>'entry_kind';
  v_old public.gate_inward_entries%ROWTYPE;
  v_new public.gate_inward_entries%ROWTYPE;
  s public.gate_inward_settings%ROWTYPE;
  v_id uuid := p_id;
  v_vehicle text := NULLIF(upper(btrim(p_data->>'vehicle_number')), '');
  v_supplier uuid := NULLIF(p_data->>'supplier_id', '')::uuid;
  v_customer uuid := NULLIF(p_data->>'customer_id', '')::uuid;
  v_po uuid := NULLIF(p_data->>'purchase_order_id', '')::uuid;
  v_pass uuid := NULLIF(p_data->>'gate_pass_id', '')::uuid;
  v_dispatch uuid := NULLIF(p_data->>'dispatch_id', '')::uuid;
  v_party text := NULLIF(btrim(p_data->>'party_name'), '');
  po public.purchase_orders%ROWTYPE;
  g public.gate_passes%ROWTYPE;
  v_ref text;
  v_want_type text;
BEGIN
  IF NOT (public.gate_inward_can('gate') OR public.gate_inward_can('office')) THEN
    RAISE EXCEPTION 'You do not have permission to make gate inward entries.';
  END IF;
  SELECT * INTO s FROM public.gate_inward_settings WHERE id;
  IF v_kind IS NULL OR v_kind <> ALL (s.enabled_kinds) THEN
    RAISE EXCEPTION 'This inward type is not enabled. Ask a super admin to enable it in the Gate Inward settings.';
  END IF;
  IF v_vehicle IS NULL THEN
    RAISE EXCEPTION 'Enter the vehicle number.';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.gate_inward_entries WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate inward entry not found.';
    END IF;
    IF v_old.status <> 'at_gate' THEN
      RAISE EXCEPTION 'Entry % is % and can no longer be edited.', v_old.entry_number, replace(v_old.status, '_', ' ');
    END IF;
    IF v_old.entry_kind <> v_kind THEN
      RAISE EXCEPTION 'The type of a saved entry cannot be changed. Cancel it and make a new one.';
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid AND NOT public.gate_inward_can('office') THEN
      RAISE EXCEPTION 'Only the guard who made this entry or the purchase office can edit it.';
    END IF;
  END IF;

  -- What the vehicle arrives against, by type.
  IF v_kind = 'purchase' THEN
    IF v_supplier IS NULL THEN
      RAISE EXCEPTION 'Choose the supplier.';
    END IF;
    IF v_po IS NULL THEN
      RAISE EXCEPTION 'Choose the purchase order this delivery is against.';
    END IF;
    SELECT * INTO po FROM public.purchase_orders WHERE id = v_po;
    IF NOT FOUND OR po.supplier_id <> v_supplier THEN
      RAISE EXCEPTION 'That purchase order does not belong to this supplier.';
    END IF;
    IF po.status NOT IN ('approved','ordered','partially_received') OR po.closed_short_at IS NOT NULL THEN
      RAISE EXCEPTION 'PO % is % and cannot receive goods.', po.po_number,
        CASE WHEN po.closed_short_at IS NOT NULL THEN 'closed short' ELSE replace(po.status, '_', ' ') END;
    END IF;
    IF NOT (po.category = ANY (s.purchase_categories)) THEN
      RAISE EXCEPTION 'PO % is a % order. Gate inward entries are only made for: %.', po.po_number,
        replace(po.category::text, '_', ' '), array_to_string(s.purchase_categories, ', ');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_order_items i
                    WHERE i.order_id = po.id AND i.quantity > COALESCE(i.quantity_received, 0)) THEN
      RAISE EXCEPTION 'PO % has been fully received already.', po.po_number;
    END IF;
    SELECT name INTO v_party FROM public.suppliers WHERE id = v_supplier;
    v_customer := NULL; v_pass := NULL; v_dispatch := NULL;
    v_ref := po.po_number;

  ELSIF v_kind IN ('returnable_return','job_work_return') THEN
    IF v_pass IS NULL THEN
      RAISE EXCEPTION 'Scan or choose the outward gate pass these goods are coming back on.';
    END IF;
    SELECT * INTO g FROM public.gate_passes WHERE id = v_pass;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate pass not found.';
    END IF;
    v_want_type := CASE v_kind WHEN 'returnable_return' THEN 'returnable' ELSE 'job_work' END;
    IF g.pass_type <> v_want_type THEN
      RAISE EXCEPTION '% is a % pass. Choose "%" instead.', g.pass_number, replace(g.pass_type, '_', ' '),
        CASE g.pass_type WHEN 'returnable' THEN 'Returnable back' WHEN 'job_work' THEN 'Job work back' ELSE 'another type' END;
    END IF;
    IF g.status NOT IN ('out','partially_returned') THEN
      RAISE EXCEPTION '% is % — nothing is outside on it.', g.pass_number, replace(g.status, '_', ' ');
    END IF;
    v_party := g.party_name;
    v_supplier := CASE WHEN g.party_kind = 'supplier' THEN g.party_id END;
    v_customer := CASE WHEN g.party_kind = 'customer' THEN g.party_id END;
    v_po := NULL; v_dispatch := NULL;
    v_ref := g.pass_number;

  ELSIF v_kind = 'sales_return' THEN
    IF v_customer IS NULL THEN
      RAISE EXCEPTION 'Choose the customer returning the goods.';
    END IF;
    SELECT name INTO v_party FROM public.customers WHERE id = v_customer;
    IF v_party IS NULL THEN
      RAISE EXCEPTION 'Customer not found.';
    END IF;
    IF v_dispatch IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM public.sales_dispatches d WHERE d.id = v_dispatch) THEN
      RAISE EXCEPTION 'Dispatch not found.';
    END IF;
    v_supplier := NULL; v_po := NULL; v_pass := NULL;

  ELSE -- sample, loading_vehicle, other
    IF v_supplier IS NOT NULL THEN
      SELECT name INTO v_party FROM public.suppliers WHERE id = v_supplier;
    ELSIF v_customer IS NOT NULL THEN
      SELECT name INTO v_party FROM public.customers WHERE id = v_customer;
    END IF;
    IF v_party IS NULL THEN
      RAISE EXCEPTION 'Enter who the vehicle has come from.';
    END IF;
    v_po := NULL; v_pass := NULL; v_dispatch := NULL;
  END IF;

  IF v_id IS NULL THEN
    -- A placeholder number until every check has passed, so a failed save
    -- never uses up a GIN number and the series stays without gaps.
    INSERT INTO public.gate_inward_entries
      (entry_number, entry_kind, party_name, vehicle_number, created_by, supplier_id, purchase_order_id, gate_pass_id)
    VALUES ('NEW-' || gen_random_uuid()::text, v_kind, v_party, v_vehicle, v_uid, v_supplier, v_po, v_pass)
    RETURNING id INTO v_id;
  END IF;

  UPDATE public.gate_inward_entries
     SET supplier_id = v_supplier,
         customer_id = v_customer,
         party_name = v_party,
         purchase_order_id = v_po,
         gate_pass_id = v_pass,
         dispatch_id = v_dispatch,
         vehicle_number = v_vehicle,
         driver_name = NULLIF(btrim(p_data->>'driver_name'), ''),
         driver_contact = NULLIF(btrim(p_data->>'driver_contact'), ''),
         transporter_name = NULLIF(btrim(p_data->>'transporter_name'), ''),
         challan_number = NULLIF(btrim(p_data->>'challan_number'), ''),
         challan_date = NULLIF(p_data->>'challan_date', '')::date,
         packages_count = NULLIF(p_data->>'packages_count', '')::integer,
         gross_weight_kg = NULLIF(p_data->>'gross_weight_kg', '')::numeric,
         challan_photo_path = NULLIF(btrim(p_data->>'challan_photo_path'), ''),
         vehicle_photo_path = NULLIF(btrim(p_data->>'vehicle_photo_path'), ''),
         remarks = NULLIF(btrim(p_data->>'remarks'), ''),
         entry_number = CASE WHEN p_id IS NULL
                             THEN 'GIN-' || lpad(nextval('public.gate_inward_number_seq')::text, 6, '0')
                             ELSE entry_number END
   WHERE id = v_id
  RETURNING * INTO v_new;

  PERFORM public.gate_inward_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END,
    public.gate_inward_kind_label(v_kind) || COALESCE(' · ' || v_ref, '') || ' · vehicle ' || v_vehicle);

  IF p_id IS NULL THEN
    PERFORM public.gate_inward_notify(v_new, 'Vehicle at gate',
      v_new.entry_number || ' · ' || public.gate_inward_kind_label(v_kind) || COALESCE(' · ' || v_ref, '')
        || ' · ' || v_party || ' · vehicle ' || v_vehicle,
      'info', true, false);
  END IF;
  RETURN v_id;
END;
$$;

-- The empty truck has left. Idempotent.
CREATE OR REPLACE FUNCTION public.gate_inward_vehicle_out(p_id uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
BEGIN
  IF NOT (public.gate_inward_can('gate') OR public.gate_inward_can('office')) THEN
    RAISE EXCEPTION 'Only gate security or the purchase office can record this.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate inward entry not found.';
  END IF;
  IF e.vehicle_out_at IS NOT NULL THEN
    RETURN e.vehicle_out_at;
  END IF;
  UPDATE public.gate_inward_entries
     SET vehicle_out_at = now(), vehicle_out_by = public.app_user_id()
   WHERE id = p_id
  RETURNING * INTO e;
  PERFORM public.gate_inward_log(p_id, 'vehicle_out', 'Vehicle ' || e.vehicle_number || ' left');
  RETURN e.vehicle_out_at;
END;
$$;

-- Office: the vehicle was turned away (wrong supplier, no PO, refused).
CREATE OR REPLACE FUNCTION public.gate_inward_reject(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
BEGIN
  IF NOT public.gate_inward_can('office') THEN
    RAISE EXCEPTION 'Only the purchase office can reject a gate inward entry.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate inward entry not found.';
  END IF;
  IF e.status <> 'at_gate' THEN
    RAISE EXCEPTION 'Entry % is already %.', e.entry_number, replace(e.status, '_', ' ');
  END IF;
  UPDATE public.gate_inward_entries
     SET status = 'rejected', rejected_by = public.app_user_id(), rejected_at = now(), reject_reason = btrim(p_reason)
   WHERE id = p_id
  RETURNING * INTO e;
  PERFORM public.gate_inward_log(p_id, 'rejected', btrim(p_reason));
  PERFORM public.gate_inward_notify(e, 'Vehicle rejected',
    e.entry_number || ' (' || e.party_name || ', vehicle ' || e.vehicle_number || ') was rejected: ' || btrim(p_reason),
    'warning', true, true);
END;
$$;

-- Made by mistake: the office, or the guard who made it while it is still at the gate.
CREATE OR REPLACE FUNCTION public.gate_inward_cancel(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate inward entry not found.';
  END IF;
  IF NOT (public.gate_inward_can('office') OR (e.created_by = v_uid AND public.gate_inward_can('gate'))) THEN
    RAISE EXCEPTION 'Only the purchase office or the guard who made this entry can cancel it.';
  END IF;
  IF e.status <> 'at_gate' THEN
    RAISE EXCEPTION 'Entry % is already %.', e.entry_number, replace(e.status, '_', ' ');
  END IF;
  UPDATE public.gate_inward_entries
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = btrim(p_reason)
   WHERE id = p_id
  RETURNING * INTO e;
  PERFORM public.gate_inward_log(p_id, 'cancelled', btrim(p_reason));
  PERFORM public.gate_inward_notify(e, 'Gate inward entry cancelled',
    e.entry_number || ' (' || e.party_name || ', vehicle ' || e.vehicle_number || ') was cancelled: ' || btrim(p_reason),
    'info', true, true);
END;
$$;

-- Office: close a sample / other entry with a note of who received it.
CREATE OR REPLACE FUNCTION public.gate_inward_close(p_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
BEGIN
  IF NOT public.gate_inward_can('office') THEN
    RAISE EXCEPTION 'Only the purchase office can close a gate inward entry.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate inward entry not found.';
  END IF;
  IF e.status <> 'at_gate' THEN
    RAISE EXCEPTION 'Entry % is already %.', e.entry_number, replace(e.status, '_', ' ');
  END IF;
  IF e.entry_kind NOT IN ('sample','other','loading_vehicle') THEN
    RAISE EXCEPTION 'A % entry is closed by its %, not by hand.', public.gate_inward_kind_label(e.entry_kind),
      CASE e.entry_kind WHEN 'purchase' THEN 'GRN' WHEN 'sales_return' THEN 'sales return' ELSE 'receipt on the gate pass' END;
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Note who received the goods.';
  END IF;
  UPDATE public.gate_inward_entries
     SET status = 'closed', closed_by = public.app_user_id(), closed_at = now(), close_note = btrim(p_note)
   WHERE id = p_id;
  PERFORM public.gate_inward_log(p_id, 'closed', btrim(p_note));
END;
$$;

-- "Receive goods" on a returnable / job-work pass names the inward entry the
-- goods came in on. Called right after gate_pass_receive with the new GPR id.
CREATE OR REPLACE FUNCTION public.gate_inward_attach_receipt(p_entry_id uuid, p_receipt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
  r public.gate_pass_receipts%ROWTYPE;
BEGIN
  IF NOT (public.gate_pass_can('create') OR public.gate_inward_can('office')) THEN
    RAISE EXCEPTION 'You do not have permission to receive goods on gate passes.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate inward entry not found.';
  END IF;
  SELECT * INTO r FROM public.gate_pass_receipts WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receipt not found.';
  END IF;
  IF e.entry_kind NOT IN ('returnable_return','job_work_return') THEN
    RAISE EXCEPTION 'Entry % is a % entry, not goods coming back on a gate pass.', e.entry_number, public.gate_inward_kind_label(e.entry_kind);
  END IF;
  IF e.status <> 'at_gate' THEN
    RAISE EXCEPTION 'Entry % is already %.', e.entry_number, replace(e.status, '_', ' ');
  END IF;
  IF e.gate_pass_id <> r.gate_pass_id THEN
    RAISE EXCEPTION 'Entry % is for another gate pass.', e.entry_number;
  END IF;
  IF r.gate_inward_id IS NOT NULL AND r.gate_inward_id <> p_entry_id THEN
    RAISE EXCEPTION 'Receipt % is already linked to another gate inward entry.', r.receipt_number;
  END IF;
  UPDATE public.gate_pass_receipts SET gate_inward_id = p_entry_id WHERE id = p_receipt_id;
  UPDATE public.gate_inward_entries
     SET status = 'received', gate_pass_receipt_id = p_receipt_id, closed_at = now(), closed_by = public.app_user_id()
   WHERE id = p_entry_id;
  PERFORM public.gate_inward_log(p_entry_id, 'received', 'Received on ' || r.receipt_number);
END;
$$;

-- An entry that is no longer at the gate was opened again on Gate Check: log it
-- (no alarm — an inward slip scanned twice is not a security risk).
CREATE OR REPLACE FUNCTION public.gate_inward_log_rescan(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
  v_n integer;
BEGIN
  IF NOT (public.gate_inward_can('gate') OR public.gate_inward_can('office')) THEN
    RAISE EXCEPTION 'Only gate security or the purchase office can use this.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_id;
  IF NOT FOUND OR e.status = 'at_gate' THEN
    RETURN jsonb_build_object('logged', false);
  END IF;
  PERFORM public.gate_inward_log(p_id, 'rescan_attempt',
    'Opened again at the gate — entry is ' || replace(e.status, '_', ' '), jsonb_build_object('status', e.status));
  SELECT count(*) INTO v_n FROM public.gate_inward_events WHERE entry_id = p_id AND event = 'rescan_attempt';
  RETURN jsonb_build_object('logged', true, 'attempts', v_n);
END;
$$;

-- Super admin: the settings row.
-- p: { require_for_grn, require_for_categories, purchase_categories, enabled_kinds, stale_days }
CREATE OR REPLACE FUNCTION public.gate_inward_settings_save(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_kinds text[];
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the Gate Inward settings.';
  END IF;
  IF p ? 'enabled_kinds' THEN
    SELECT array_agg(x) INTO v_kinds FROM jsonb_array_elements_text(p->'enabled_kinds') x;
    IF v_kinds IS NULL OR NOT (v_kinds <@ ARRAY['purchase','returnable_return','job_work_return',
                                                   'sales_return','sample','loading_vehicle','other']) THEN
      RAISE EXCEPTION 'Unknown inward type in enabled_kinds.';
    END IF;
  END IF;
  UPDATE public.gate_inward_settings
     SET require_for_grn = COALESCE((p->>'require_for_grn')::boolean, require_for_grn),
         require_for_categories = CASE WHEN p ? 'require_for_categories'
           THEN (SELECT COALESCE(array_agg(x::public.purchase_category), '{}') FROM jsonb_array_elements_text(p->'require_for_categories') x)
           ELSE require_for_categories END,
         purchase_categories = CASE WHEN p ? 'purchase_categories'
           THEN (SELECT COALESCE(array_agg(x::public.purchase_category), '{}') FROM jsonb_array_elements_text(p->'purchase_categories') x)
           ELSE purchase_categories END,
         enabled_kinds = COALESCE(v_kinds, enabled_kinds),
         stale_days = COALESCE((p->>'stale_days')::integer, stale_days),
         updated_by = public.app_user_id(),
         updated_at = now()
   WHERE id;
END;
$$;

-- 6. The GRN names its gate inward entry ------------------------------------

-- BEFORE INSERT: a named entry must be a purchase entry, still at the gate and
-- for this PO. With require_for_grn on, a GRN in a required category must
-- name one. OFF by default, so today's GRN flow is unchanged.
CREATE OR REPLACE FUNCTION public.gate_inward_check_grn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.gate_inward_settings%ROWTYPE;
  e public.gate_inward_entries%ROWTYPE;
  po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO s FROM public.gate_inward_settings WHERE id;
  SELECT * INTO po FROM public.purchase_orders WHERE id = NEW.purchase_order_id;
  IF NEW.gate_inward_id IS NOT NULL THEN
    SELECT * INTO e FROM public.gate_inward_entries WHERE id = NEW.gate_inward_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate inward entry not found.';
    END IF;
    IF e.entry_kind <> 'purchase' THEN
      RAISE EXCEPTION 'Gate inward entry % is a % entry, not a purchase delivery.', e.entry_number, public.gate_inward_kind_label(e.entry_kind);
    END IF;
    IF e.status <> 'at_gate' THEN
      RAISE EXCEPTION 'Gate inward entry % is already % and cannot be received again.', e.entry_number, replace(e.status, '_', ' ');
    END IF;
    IF e.purchase_order_id IS DISTINCT FROM NEW.purchase_order_id THEN
      RAISE EXCEPTION 'Gate inward entry % is for PO %, not this purchase order.', e.entry_number,
        (SELECT po_number FROM public.purchase_orders WHERE id = e.purchase_order_id);
    END IF;
  ELSIF s.require_for_grn AND po.category = ANY (s.require_for_categories) THEN
    RAISE EXCEPTION 'Goods receipt blocked: no gate inward entry was chosen. The gate must record the vehicle for PO % before it can be received.', po.po_number;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gate_inward_check_grn ON public.goods_receipt_notes;
CREATE TRIGGER trg_gate_inward_check_grn
  BEFORE INSERT ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.gate_inward_check_grn();

-- AFTER INSERT: close the entry; AFTER DELETE: reopen it if its GRN is removed.
CREATE OR REPLACE FUNCTION public.gate_inward_after_grn()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.gate_inward_id IS NOT NULL THEN
      UPDATE public.gate_inward_entries
         SET status = 'grn_made', grn_id = NEW.id, closed_at = now(), closed_by = NEW.received_by
       WHERE id = NEW.gate_inward_id AND status = 'at_gate';
      PERFORM public.gate_inward_log(NEW.gate_inward_id, 'grn_made', 'Received on ' || COALESCE(NEW.grn_number, 'GRN'));
    END IF;
    RETURN NEW;
  ELSE
    IF OLD.gate_inward_id IS NOT NULL THEN
      UPDATE public.gate_inward_entries
         SET status = 'at_gate', grn_id = NULL, closed_at = NULL, closed_by = NULL
       WHERE id = OLD.gate_inward_id AND status = 'grn_made';
      PERFORM public.gate_inward_log(OLD.gate_inward_id, 'grn_removed',
        COALESCE(OLD.grn_number, 'The GRN') || ' was deleted — back at the gate');
    END IF;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_gate_inward_after_grn ON public.goods_receipt_notes;
CREATE TRIGGER trg_gate_inward_after_grn
  AFTER INSERT OR DELETE ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.gate_inward_after_grn();

-- 7. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.gate_inward_can(text),
  public.gate_inward_kind_label(text),
  public.gate_inward_open_pos(uuid),
  public.gate_inward_suppliers(),
  public.gate_inward_open_passes(text),
  public.gate_inward_save(uuid, jsonb),
  public.gate_inward_vehicle_out(uuid),
  public.gate_inward_reject(uuid, text),
  public.gate_inward_cancel(uuid, text),
  public.gate_inward_close(uuid, text),
  public.gate_inward_attach_receipt(uuid, uuid),
  public.gate_inward_log_rescan(uuid),
  public.gate_inward_settings_save(jsonb)
TO anon, authenticated, service_role;

-- Internal building blocks: only callable from the functions above.
REVOKE EXECUTE ON FUNCTION
  public.gate_inward_log(uuid, text, text, jsonb),
  public.gate_inward_notify(public.gate_inward_entries, text, text, text, boolean, boolean)
FROM PUBLIC, anon, authenticated;
