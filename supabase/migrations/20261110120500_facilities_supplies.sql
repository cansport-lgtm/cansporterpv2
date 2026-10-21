-- ============================================================================
-- Admin & Facilities — admin store and supply requests (SR-…)
-- ----------------------------------------------------------------------------
-- A small stock of office consumables (stationery, toner, tea, cleaning
-- material: items of the item master with category office_supplies) kept by
-- the admin office, and the way employees ask for them.
--
-- Flow of a supply request:
--   requester saves a draft → submits → pending_hod
--     → a head of the department approves (may lower quantities) → approved
--     → the admin officer issues from the store (issued ≤ approved ≤ on hand)
--        → issued, stock reduced, the requester acknowledges
--   rejected by the head (reason required)
--   cancelled by the requester before issue (reason when submitted), or by a
--   facilities manager before issue
-- Every request needs the department head's approval (decision 21 Oct 2026).
-- When the requester is a head of the department the head step passes
-- automatically, like purchase requests. Department heads are the existing
-- purchase_request_department_heads rows (Purchase → Purchase Requests →
-- Settings).
--
-- Stock: facilities_store_items (on hand, reorder level, reorder qty) and a
-- ledger of every change (opening, adjustment, issue, receipt). Items at or
-- below their reorder level appear in v_facilities_store_shortage; the admin
-- officer turns them into a normal purchase request (PRQ-, category Office
-- Supplies) with facilities_store_reorder_to_prq, which hands over to the
-- existing purchase flow. facilities_store_receive posts goods into the store
-- (the GRN hook comes later).
--
-- Who:
--   raise / edit own draft / submit / cancel own / acknowledge   any logged-in user
--   approve / reject   heads of the request's department (purchase_request_is_dept_head)
--   issue, reorder     facilities_can('operate')
--   stock master, adjustments, cancel any   facilities_can('manage')
--
-- Tables are read-only to clients: every write goes through the SECURITY
-- DEFINER facilities_* functions below. Every action is logged in
-- facilities_events (document_type 'supply_request' / 'store').
-- Rollback: supabase/rollbacks/20261110120500_facilities_supplies_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.facilities_supply_request_seq;

CREATE TABLE IF NOT EXISTS public.facilities_store_items (
  item_id uuid PRIMARY KEY REFERENCES public.items(id) ON DELETE RESTRICT,
  on_hand numeric(15,3) NOT NULL DEFAULT 0,
  reorder_level numeric(15,3) NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  reorder_qty numeric(15,3) NOT NULL DEFAULT 0 CHECK (reorder_qty >= 0),
  location text,
  is_active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facilities_store_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('opening','adjustment','issue','receipt')),
  qty numeric(15,3) NOT NULL,            -- signed: issues are negative
  balance_after numeric(15,3) NOT NULL,
  ref_type text,                          -- 'supply_request', 'grn', …
  ref_id uuid,
  reason text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_store_ledger_item_idx
  ON public.facilities_store_ledger (item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.facilities_supply_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_hod','approved','issued','rejected','cancelled')),
  request_date date NOT NULL DEFAULT public.facilities_today(),
  reason text NOT NULL,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  hod_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  hod_at timestamptz,
  hod_remarks text,
  issued_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  issued_at timestamptz,
  acknowledged_at timestamptz,
  rejected_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  reject_reason text,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS facilities_supply_requests_status_idx
  ON public.facilities_supply_requests (status, department_id);
CREATE INDEX IF NOT EXISTS facilities_supply_requests_created_by_idx
  ON public.facilities_supply_requests (created_by, created_at DESC);

CREATE TABLE IF NOT EXISTS public.facilities_supply_request_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.facilities_supply_requests(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  requested_qty numeric(15,3) NOT NULL CHECK (requested_qty > 0),
  approved_qty numeric(15,3) CHECK (approved_qty IS NULL OR approved_qty >= 0),
  issued_qty numeric(15,3) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, item_id)
);
CREATE INDEX IF NOT EXISTS facilities_supply_request_lines_request_idx
  ON public.facilities_supply_request_lines (request_id, line_no);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_store_items','facilities_store_ledger',
                           'facilities_supply_requests','facilities_supply_request_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- Items at or below their reorder level.
CREATE OR REPLACE VIEW public.v_facilities_store_shortage AS
SELECT s.item_id, i.code AS item_code, i.name AS item_name, u.symbol AS uom,
       s.on_hand, s.reorder_level, s.reorder_qty, s.location,
       COALESCE(i.unit_price, 0) AS unit_price
  FROM public.facilities_store_items s
  JOIN public.items i ON i.id = s.item_id
  LEFT JOIN public.units_of_measure u ON u.id = i.uom_id
 WHERE s.is_active AND s.on_hand <= s.reorder_level;
GRANT SELECT ON public.v_facilities_store_shortage TO anon, authenticated, service_role;

-- 2. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_supply_request_label(p_req public.facilities_supply_requests)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_req.request_number
      || COALESCE(' · ' || (SELECT d.name FROM public.production_departments d WHERE d.id = p_req.department_id), '');
$$;

-- Tell the department heads of a request; never the actor.
CREATE OR REPLACE FUNCTION public.facilities_supply_request_notify_heads(
  p_req public.facilities_supply_requests, p_title text, p_message text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT h.user_id FROM public.purchase_request_department_heads h
      JOIN public.app_users u ON u.id = h.user_id
     WHERE h.department_id = p_req.department_id AND u.is_active
  LOOP
    PERFORM public.facilities_notify_user(r.user_id, p_title, p_message,
      '/my-supply-requests/' || p_req.id::text, 'facilities_supply_request', p_req.id, 'info');
  END LOOP;
END;
$$;

-- Move stock and write the ledger row. Returns the new balance.
CREATE OR REPLACE FUNCTION public.facilities_store_post(
  p_item_id uuid, p_entry_type text, p_qty numeric, p_ref_type text, p_ref_id uuid, p_reason text
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_balance numeric;
BEGIN
  INSERT INTO public.facilities_store_items (item_id) VALUES (p_item_id) ON CONFLICT (item_id) DO NOTHING;
  UPDATE public.facilities_store_items
     SET on_hand = on_hand + p_qty, updated_by = public.app_user_id(), updated_at = now()
   WHERE item_id = p_item_id
   RETURNING on_hand INTO v_balance;
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Stock of % would go below zero.',
      (SELECT code || ' ' || name FROM public.items WHERE id = p_item_id);
  END IF;
  INSERT INTO public.facilities_store_ledger (item_id, entry_type, qty, balance_after, ref_type, ref_id, reason, created_by)
  VALUES (p_item_id, p_entry_type, p_qty, v_balance, p_ref_type, p_ref_id, p_reason, public.app_user_id());
  RETURN v_balance;
END;
$$;

-- 3. Stock master ------------------------------------------------------------

-- Add an item to the store or change its reorder settings.
-- p_data: { reorder_level, reorder_qty, location, is_active }
CREATE OR REPLACE FUNCTION public.facilities_store_item_save(p_item_id uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE it record;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can set up admin store items.';
  END IF;
  SELECT i.id, i.code, i.name, i.category, COALESCE(i.is_active, true) AS is_active INTO it
    FROM public.items i WHERE i.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an item from the item master.';
  END IF;
  IF it.category IS DISTINCT FROM 'office_supplies'::public.purchase_category THEN
    RAISE EXCEPTION 'Item % % is not an Office Supplies item.', it.code, it.name;
  END IF;
  INSERT INTO public.facilities_store_items (item_id, reorder_level, reorder_qty, location, is_active, updated_by)
  VALUES (p_item_id,
          COALESCE(NULLIF(p_data->>'reorder_level', '')::numeric, 0),
          COALESCE(NULLIF(p_data->>'reorder_qty', '')::numeric, 0),
          NULLIF(btrim(p_data->>'location'), ''),
          COALESCE((p_data->>'is_active')::boolean, true),
          public.app_user_id())
  ON CONFLICT (item_id) DO UPDATE SET
    reorder_level = COALESCE(NULLIF(p_data->>'reorder_level', '')::numeric, public.facilities_store_items.reorder_level),
    reorder_qty = COALESCE(NULLIF(p_data->>'reorder_qty', '')::numeric, public.facilities_store_items.reorder_qty),
    location = CASE WHEN p_data ? 'location' THEN NULLIF(btrim(p_data->>'location'), '') ELSE public.facilities_store_items.location END,
    is_active = COALESCE((p_data->>'is_active')::boolean, public.facilities_store_items.is_active),
    updated_by = public.app_user_id(), updated_at = now();
  PERFORM public.facilities_log('store', p_item_id, 'item_saved', it.code || ' ' || it.name || ' set up', p_data);
END;
$$;

-- Opening stock or a counted adjustment (signed quantity, reason required).
CREATE OR REPLACE FUNCTION public.facilities_store_adjust(
  p_item_id uuid, p_qty numeric, p_reason text, p_entry_type text DEFAULT 'adjustment'
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_reason text := NULLIF(btrim(p_reason), '');
  it record;
  v_balance numeric;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can adjust admin store stock.';
  END IF;
  IF p_entry_type NOT IN ('opening','adjustment') THEN
    RAISE EXCEPTION 'Choose Opening stock or Adjustment.';
  END IF;
  IF p_qty IS NULL OR p_qty = 0 THEN
    RAISE EXCEPTION 'Enter the quantity (negative to reduce).';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Give the reason for the adjustment.';
  END IF;
  SELECT i.id, i.code, i.name, i.category INTO it FROM public.items i WHERE i.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an item from the item master.';
  END IF;
  IF it.category IS DISTINCT FROM 'office_supplies'::public.purchase_category THEN
    RAISE EXCEPTION 'Item % % is not an Office Supplies item.', it.code, it.name;
  END IF;
  v_balance := public.facilities_store_post(p_item_id, p_entry_type, p_qty, NULL, NULL, v_reason);
  PERFORM public.facilities_log('store', p_item_id, p_entry_type,
    it.code || ' ' || it.name || ': ' || CASE WHEN p_qty > 0 THEN '+' ELSE '' END || p_qty || ' → ' || v_balance || ' (' || v_reason || ')');
  RETURN v_balance;
END;
$$;

-- Goods received into the store (GRN hook later; also usable by hand).
CREATE OR REPLACE FUNCTION public.facilities_store_receive(
  p_item_id uuid, p_qty numeric, p_ref_type text DEFAULT NULL, p_ref_id uuid DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE it record; v_balance numeric;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to receive stock into the admin store.';
  END IF;
  IF p_qty IS NULL OR p_qty <= 0 THEN
    RAISE EXCEPTION 'Enter the received quantity.';
  END IF;
  SELECT i.id, i.code, i.name, i.category INTO it FROM public.items i WHERE i.id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an item from the item master.';
  END IF;
  IF it.category IS DISTINCT FROM 'office_supplies'::public.purchase_category THEN
    RAISE EXCEPTION 'Item % % is not an Office Supplies item.', it.code, it.name;
  END IF;
  v_balance := public.facilities_store_post(p_item_id, 'receipt', p_qty, p_ref_type, p_ref_id, NULL);
  PERFORM public.facilities_log('store', p_item_id, 'receipt',
    it.code || ' ' || it.name || ': +' || p_qty || ' → ' || v_balance);
  RETURN v_balance;
END;
$$;

-- 4. Supply requests: raise -----------------------------------------------------

-- Create or edit a draft. p_data: { department_id, reason, lines: [{ item_id, requested_qty, remarks }] }
-- p_submit = true also submits it.
CREATE OR REPLACE FUNCTION public.facilities_supply_request_save(p_id uuid, p_data jsonb, p_submit boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_old public.facilities_supply_requests%ROWTYPE;
  v_id uuid := p_id;
  v_department uuid := NULLIF(p_data->>'department_id', '')::uuid;
  v_reason text := NULLIF(btrim(p_data->>'reason'), '');
  x jsonb;
  it record;
  v_qty numeric;
  v_n integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Log in again to raise a supply request.';
  END IF;
  IF v_department IS NULL OR NOT EXISTS (SELECT 1 FROM public.production_departments WHERE id = v_department) THEN
    RAISE EXCEPTION 'Choose the department.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Write what the items are needed for.';
  END IF;
  IF jsonb_typeof(COALESCE(p_data->'lines', 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_data->'lines') = 0 THEN
    RAISE EXCEPTION 'Add at least one item.';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.facilities_supply_requests WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Supply request not found.';
    END IF;
    IF v_old.status <> 'draft' THEN
      RAISE EXCEPTION 'Supply request % is % and can no longer be edited.', v_old.request_number, replace(v_old.status, '_', ' ');
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Only the person who raised this request can edit it.';
    END IF;
    UPDATE public.facilities_supply_requests
       SET department_id = v_department, reason = v_reason, updated_at = now()
     WHERE id = v_id;
    DELETE FROM public.facilities_supply_request_lines WHERE request_id = v_id;
  ELSE
    INSERT INTO public.facilities_supply_requests (request_number, department_id, reason, created_by)
    VALUES ('NEW-' || gen_random_uuid()::text, v_department, v_reason, v_uid)
    RETURNING id INTO v_id;
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_data->'lines') LOOP
    SELECT i.id, i.code, i.name, i.category, COALESCE(i.is_active, true) AS is_active
      INTO it FROM public.items i WHERE i.id = NULLIF(x->>'item_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line %: choose an item from the item master.', v_n + 1;
    END IF;
    IF NOT it.is_active THEN
      RAISE EXCEPTION 'Item % % is not active.', it.code, it.name;
    END IF;
    IF it.category IS DISTINCT FROM 'office_supplies'::public.purchase_category THEN
      RAISE EXCEPTION 'Item % % is not an Office Supplies item.', it.code, it.name;
    END IF;
    IF it.id = ANY (v_seen) THEN
      RAISE EXCEPTION 'Item % % is on the request twice — put the total on one line.', it.code, it.name;
    END IF;
    v_qty := NULLIF(x->>'requested_qty', '')::numeric;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Enter the quantity for % %.', it.code, it.name;
    END IF;
    v_n := v_n + 1;
    v_seen := v_seen || it.id;
    INSERT INTO public.facilities_supply_request_lines (request_id, line_no, item_id, requested_qty, remarks)
    VALUES (v_id, v_n, it.id, v_qty, NULLIF(btrim(x->>'remarks'), ''));
  END LOOP;

  IF p_submit THEN
    PERFORM public.purchase_request_assert_head(v_department);
  END IF;
  -- The number is given only once every check has passed, so a failed save
  -- never uses one up and the series stays without gaps.
  IF p_id IS NULL THEN
    UPDATE public.facilities_supply_requests
       SET request_number = 'SR-' || lpad(nextval('public.facilities_supply_request_seq')::text, 6, '0')
     WHERE id = v_id;
  END IF;
  PERFORM public.facilities_log('supply_request', v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END,
    v_n || ' item(s)');

  IF p_submit THEN
    PERFORM public.facilities_supply_request_submit(v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_supply_request_submit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_supply_requests%ROWTYPE;
  v_self_head boolean;
BEGIN
  SELECT * INTO r FROM public.facilities_supply_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'Supply request % has already been submitted.', r.request_number;
  END IF;
  IF r.created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the person who raised this request can submit it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities_supply_request_lines WHERE request_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one item.';
  END IF;

  v_self_head := EXISTS (SELECT 1 FROM public.purchase_request_department_heads h
                          WHERE h.department_id = r.department_id AND h.user_id = v_uid);
  IF v_self_head THEN
    UPDATE public.facilities_supply_request_lines SET approved_qty = requested_qty WHERE request_id = p_id;
    UPDATE public.facilities_supply_requests
       SET status = 'approved', submitted_at = now(),
           hod_by = v_uid, hod_at = now(), hod_remarks = 'Raised by the department head', updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.facilities_log('supply_request', p_id, 'submitted');
    PERFORM public.facilities_log('supply_request', p_id, 'hod_approved', 'Passed automatically: raised by the department head');
    PERFORM public.facilities_notify_managers('Supply request ready to issue',
      public.facilities_supply_request_label(r) || ': ' || r.reason,
      '/facilities/supplies/' || p_id::text, 'facilities_supply_request', p_id, 'info', true);
    RETURN r.status;
  END IF;

  PERFORM public.purchase_request_assert_head(r.department_id);
  UPDATE public.facilities_supply_requests
     SET status = 'pending_hod', submitted_at = now(), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.facilities_log('supply_request', p_id, 'submitted');
  PERFORM public.facilities_supply_request_notify_heads(r, 'Supply request needs your approval',
    public.facilities_supply_request_label(r) || ': ' || r.reason);
  RETURN r.status;
END;
$$;

-- 5. Supply requests: approval, issue, close ----------------------------------

-- Department head approval. p_lines: [{ id, approved_qty }] (optional; a
-- quantity may be lowered, never raised; 0 drops the line).
CREATE OR REPLACE FUNCTION public.facilities_supply_request_approve(p_id uuid, p_lines jsonb DEFAULT NULL, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_supply_requests%ROWTYPE;
  x jsonb;
  l public.facilities_supply_request_lines%ROWTYPE;
  v_qty numeric;
  v_left integer;
BEGIN
  SELECT * INTO r FROM public.facilities_supply_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF r.status <> 'pending_hod' THEN
    RAISE EXCEPTION 'Supply request % is not waiting for the department head.', r.request_number;
  END IF;
  IF NOT public.purchase_request_is_dept_head(r.department_id) THEN
    RAISE EXCEPTION 'Only a head of this department can approve this request.';
  END IF;

  UPDATE public.facilities_supply_request_lines
     SET approved_qty = COALESCE(approved_qty, requested_qty) WHERE request_id = p_id;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO l FROM public.facilities_supply_request_lines
     WHERE id = NULLIF(x->>'id', '')::uuid AND request_id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A line does not belong to this request.';
    END IF;
    IF x ? 'approved_qty' THEN
      v_qty := NULLIF(x->>'approved_qty', '')::numeric;
      IF v_qty IS NULL OR v_qty < 0 THEN
        RAISE EXCEPTION 'Line %: enter an approved quantity of 0 or more.', l.line_no;
      END IF;
      IF v_qty > l.requested_qty THEN
        RAISE EXCEPTION 'Line %: the approved quantity cannot be more than the % requested.', l.line_no, l.requested_qty;
      END IF;
      UPDATE public.facilities_supply_request_lines SET approved_qty = v_qty WHERE id = l.id;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_left FROM public.facilities_supply_request_lines WHERE request_id = p_id AND approved_qty > 0;
  IF v_left = 0 THEN
    RAISE EXCEPTION 'Every line is 0. Reject the request instead.';
  END IF;

  UPDATE public.facilities_supply_requests
     SET status = 'approved', hod_by = v_uid, hod_at = now(), hod_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.facilities_log('supply_request', p_id, 'hod_approved', NULLIF(btrim(p_remarks), ''));
  PERFORM public.facilities_notify_user(r.created_by, 'Supply request approved',
    public.facilities_supply_request_label(r) || ' was approved by your department head.',
    '/my-supply-requests/' || p_id::text, 'facilities_supply_request', p_id, 'success');
  PERFORM public.facilities_notify_managers('Supply request ready to issue',
    public.facilities_supply_request_label(r) || ': ' || r.reason,
    '/facilities/supplies/' || p_id::text, 'facilities_supply_request', p_id, 'info', true);
  RETURN r.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_supply_request_reject(p_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_supply_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  SELECT * INTO r FROM public.facilities_supply_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF r.status <> 'pending_hod' THEN
    RAISE EXCEPTION 'Supply request % is not waiting for the department head.', r.request_number;
  END IF;
  IF NOT public.purchase_request_is_dept_head(r.department_id) THEN
    RAISE EXCEPTION 'Only a head of this department can reject this request.';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the request.';
  END IF;
  UPDATE public.facilities_supply_requests
     SET status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_reason, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.facilities_log('supply_request', p_id, 'rejected', v_reason);
  PERFORM public.facilities_notify_user(r.created_by, 'Supply request rejected',
    public.facilities_supply_request_label(r) || ': ' || v_reason,
    '/my-supply-requests/' || p_id::text, 'facilities_supply_request', p_id, 'warning');
  RETURN r.status;
END;
$$;

-- The requester (before issue) or a facilities manager cancels it.
CREATE OR REPLACE FUNCTION public.facilities_supply_request_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_supply_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_manager boolean := public.facilities_can('manage');
BEGIN
  SELECT * INTO r FROM public.facilities_supply_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF r.status NOT IN ('draft','pending_hod','approved') THEN
    RAISE EXCEPTION 'Supply request % is % and cannot be cancelled.', r.request_number, r.status;
  END IF;
  IF r.created_by IS DISTINCT FROM v_uid AND NOT v_manager THEN
    RAISE EXCEPTION 'Only the person who raised this request or a facilities manager can cancel it.';
  END IF;
  IF r.status <> 'draft' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the request.';
  END IF;
  UPDATE public.facilities_supply_requests
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = v_reason, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.facilities_log('supply_request', p_id, 'cancelled', v_reason);
  IF r.created_by IS DISTINCT FROM v_uid THEN
    PERFORM public.facilities_notify_user(r.created_by, 'Supply request cancelled',
      public.facilities_supply_request_label(r) || COALESCE(': ' || v_reason, ''),
      '/my-supply-requests/' || p_id::text, 'facilities_supply_request', p_id, 'warning');
  END IF;
  RETURN r.status;
END;
$$;

-- The admin officer hands the items over. p_lines: [{ id, issued_qty }]; a line
-- not listed is issued in full (its approved quantity). issued ≤ approved and
-- ≤ on hand; stock is reduced and the ledger written.
CREATE OR REPLACE FUNCTION public.facilities_supply_request_issue(p_id uuid, p_lines jsonb DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_supply_requests%ROWTYPE;
  x jsonb;
  l record;
  v_qty numeric;
  v_on_hand numeric;
  v_total numeric := 0;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to issue supplies.';
  END IF;
  SELECT * INTO r FROM public.facilities_supply_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF r.status <> 'approved' THEN
    RAISE EXCEPTION 'Supply request % is not approved for issue.', r.request_number;
  END IF;

  UPDATE public.facilities_supply_request_lines SET issued_qty = COALESCE(approved_qty, 0) WHERE request_id = p_id;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_qty := NULLIF(x->>'issued_qty', '')::numeric;
    IF v_qty IS NULL OR v_qty < 0 THEN
      RAISE EXCEPTION 'Enter an issued quantity of 0 or more on every line.';
    END IF;
    UPDATE public.facilities_supply_request_lines SET issued_qty = v_qty
     WHERE id = NULLIF(x->>'id', '')::uuid AND request_id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A line does not belong to this request.';
    END IF;
  END LOOP;

  FOR l IN
    SELECT sl.id, sl.line_no, sl.item_id, sl.approved_qty, sl.issued_qty, i.code, i.name
      FROM public.facilities_supply_request_lines sl JOIN public.items i ON i.id = sl.item_id
     WHERE sl.request_id = p_id ORDER BY sl.line_no
  LOOP
    IF l.issued_qty > COALESCE(l.approved_qty, 0) THEN
      RAISE EXCEPTION '% %: issued % is more than the approved %.', l.code, l.name, l.issued_qty, l.approved_qty;
    END IF;
    IF l.issued_qty > 0 THEN
      SELECT on_hand INTO v_on_hand FROM public.facilities_store_items WHERE item_id = l.item_id AND is_active;
      IF v_on_hand IS NULL OR v_on_hand < l.issued_qty THEN
        RAISE EXCEPTION '% %: only % in the admin store, cannot issue %.', l.code, l.name, COALESCE(v_on_hand, 0), l.issued_qty;
      END IF;
      PERFORM public.facilities_store_post(l.item_id, 'issue', -l.issued_qty, 'supply_request', p_id, r.request_number);
      v_total := v_total + l.issued_qty;
    END IF;
  END LOOP;
  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nothing is being issued. Cancel the request instead.';
  END IF;

  UPDATE public.facilities_supply_requests
     SET status = 'issued', issued_by = v_uid, issued_at = now(), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.facilities_log('supply_request', p_id, 'issued');
  PERFORM public.facilities_notify_user(r.created_by, 'Supplies issued',
    public.facilities_supply_request_label(r) || ' — collect the items and acknowledge receipt.',
    '/my-supply-requests/' || p_id::text, 'facilities_supply_request', p_id, 'success');
  RETURN r.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_supply_request_acknowledge(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.facilities_supply_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.facilities_supply_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supply request not found.';
  END IF;
  IF r.status <> 'issued' THEN
    RAISE EXCEPTION 'Supply request % has not been issued yet.', r.request_number;
  END IF;
  IF r.created_by IS DISTINCT FROM public.app_user_id() THEN
    RAISE EXCEPTION 'Only the person who raised this request can acknowledge receipt.';
  END IF;
  IF r.acknowledged_at IS NOT NULL THEN
    RETURN;
  END IF;
  UPDATE public.facilities_supply_requests SET acknowledged_at = now(), updated_at = now() WHERE id = p_id;
  PERFORM public.facilities_log('supply_request', p_id, 'acknowledged', 'Receipt acknowledged by the requester');
END;
$$;

-- 6. Reorder → purchase request ----------------------------------------------------

-- Turn store shortages into a purchase request (PRQ-, Office Supplies) with
-- each item's reorder quantity, in the existing purchase flow. Returns the
-- draft's id; the officer reviews and submits it on My Purchase Requests.
CREATE OR REPLACE FUNCTION public.facilities_store_reorder_to_prq(
  p_item_ids uuid[], p_department_id uuid, p_purpose text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lines jsonb := '[]'::jsonb;
  v_item record;
  v_prq uuid;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to raise purchase requests for the admin store.';
  END IF;
  IF p_department_id IS NULL THEN
    RAISE EXCEPTION 'Choose the department the purchase request is raised for.';
  END IF;
  FOR v_item IN
    SELECT s.item_id, s.item_code, s.item_name, s.reorder_qty
      FROM public.v_facilities_store_shortage s
     WHERE p_item_ids IS NULL OR s.item_id = ANY (p_item_ids)
     ORDER BY s.item_name
  LOOP
    IF v_item.reorder_qty <= 0 THEN
      RAISE EXCEPTION '% % has no reorder quantity set.', v_item.item_code, v_item.item_name;
    END IF;
    v_lines := v_lines || jsonb_build_object('item_id', v_item.item_id, 'requested_qty', v_item.reorder_qty,
                                             'remarks', 'Admin store reorder');
  END LOOP;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'No item is below its reorder level.';
  END IF;

  v_prq := public.purchase_request_save(NULL, jsonb_build_object(
    'category', 'office_supplies',
    'department_id', p_department_id,
    'priority', 'normal',
    'purpose', COALESCE(NULLIF(btrim(p_purpose), ''), 'Admin store reorder: items at or below reorder level'),
    'lines', v_lines), false);

  PERFORM public.facilities_log('store', v_prq, 'reorder_prq',
    'Purchase request raised for ' || jsonb_array_length(v_lines) || ' item(s)',
    jsonb_build_object('purchase_request_id', v_prq, 'items', p_item_ids));
  RETURN v_prq;
END;
$$;

-- 7. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_supply_request_label(public.facilities_supply_requests),
  public.facilities_store_item_save(uuid, jsonb),
  public.facilities_store_adjust(uuid, numeric, text, text),
  public.facilities_store_receive(uuid, numeric, text, uuid),
  public.facilities_supply_request_save(uuid, jsonb, boolean),
  public.facilities_supply_request_submit(uuid),
  public.facilities_supply_request_approve(uuid, jsonb, text),
  public.facilities_supply_request_reject(uuid, text),
  public.facilities_supply_request_cancel(uuid, text),
  public.facilities_supply_request_issue(uuid, jsonb),
  public.facilities_supply_request_acknowledge(uuid),
  public.facilities_store_reorder_to_prq(uuid[], uuid, text)
  TO anon, authenticated, service_role;

-- Internal helpers: only the functions above (same owner) call them.
REVOKE ALL ON FUNCTION public.facilities_store_post(uuid, text, numeric, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.facilities_supply_request_notify_heads(public.facilities_supply_requests, text, text) FROM PUBLIC, anon, authenticated;
