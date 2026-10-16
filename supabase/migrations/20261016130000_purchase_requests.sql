-- ============================================================================
-- Purchase Requests (PRQ-…): any department asks Purchase to buy items
-- ----------------------------------------------------------------------------
-- Four categories, the existing purchase_category values:
--   office_supplies     Office Supplies
--   raw_material        Raw Material          (optional job order reference)
--   general_supplies    Production Supplies   (gloves, clippers, …)
--   spare_maintenance   Spares & Parts        (machine, breakdown flag)
-- Every line is an item from the item master of the request's category.
--
-- Flow:
--   requester saves a draft → submits → pending_hod
--     → department head approves → pending_purchase
--     → purchase approver (for that category) approves
--         estimated value ≤ approval limit → approved
--         estimated value  > approval limit → pending_final → super admin → approved
--   rejected at any approval stage (reason required)
--   cancelled by the requester before it is approved, or by a purchase manager
--   / super admin before it is ordered
--   partially_ordered / ordered are reserved for the PR → PO step (phase 2).
--
-- When the requester is a head of the request's department, the department
-- head stage is passed automatically (logged as such).
-- Approvers may lower line quantities (never raise them above the request);
-- the purchase approver also sets the estimated rate (defaults to the item's
-- unit price). Estimated value = Σ approved qty × estimated rate.
--
-- Who:
--   raise          any logged-in user (self service)
--   department head  rows in purchase_request_department_heads (super admin
--                    sets them); super admin may act for any department
--   purchase       super_admin, purchase_manager, or a user whose
--                  purchase_category_permissions row for the category has
--                  can_approve — never on their own request
--   final          super_admin
--   settings       super_admin (approval limit, department heads)
--
-- Tables are read-only to clients: every write goes through the SECURITY
-- DEFINER purchase_request_* functions below. Every action is logged in
-- purchase_request_events.
-- Rollback: supabase/rollbacks/20261016130000_purchase_requests_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.purchase_request_number_seq;

CREATE TABLE IF NOT EXISTS public.purchase_request_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Requests whose estimated value is above this need super admin approval.
  approval_limit numeric(15,2) NOT NULL DEFAULT 100000 CHECK (approval_limit >= 0),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.purchase_request_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.purchase_request_department_heads (
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);
CREATE INDEX IF NOT EXISTS purchase_request_department_heads_user_idx
  ON public.purchase_request_department_heads (user_id);

CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number text NOT NULL UNIQUE,
  category public.purchase_category NOT NULL,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_hod','pending_purchase','pending_final','approved',
                      'partially_ordered','ordered','rejected','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  request_date date NOT NULL DEFAULT ((now() AT TIME ZONE 'Asia/Karachi')::date),
  required_by date,
  purpose text NOT NULL,
  -- Spares & Parts
  machine_id uuid REFERENCES public.machines(id) ON DELETE SET NULL,
  is_breakdown boolean NOT NULL DEFAULT false,
  -- Raw Material
  job_order_ref text,
  estimated_total numeric(15,2) NOT NULL DEFAULT 0,
  needs_final_approval boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  hod_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  hod_at timestamptz,
  hod_remarks text,
  purchase_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  purchase_at timestamptz,
  purchase_remarks text,
  final_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  final_at timestamptz,
  final_remarks text,
  rejected_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  rejected_at timestamptz,
  reject_reason text,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS purchase_requests_status_idx ON public.purchase_requests (status, category);
CREATE INDEX IF NOT EXISTS purchase_requests_created_by_idx ON public.purchase_requests (created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_requests_department_idx ON public.purchase_requests (department_id, status);

CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  line_no integer NOT NULL,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  requested_qty numeric(15,3) NOT NULL CHECK (requested_qty > 0),
  approved_qty numeric(15,3) CHECK (approved_qty IS NULL OR approved_qty >= 0),
  ordered_qty numeric(15,3) NOT NULL DEFAULT 0 CHECK (ordered_qty >= 0),
  est_rate numeric(15,2) NOT NULL DEFAULT 0 CHECK (est_rate >= 0),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, item_id)
);
CREATE INDEX IF NOT EXISTS purchase_request_items_request_idx ON public.purchase_request_items (request_id, line_no);

CREATE TABLE IF NOT EXISTS public.purchase_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_request_events_request_idx ON public.purchase_request_events (request_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['purchase_request_settings','purchase_request_department_heads',
                           'purchase_requests','purchase_request_items','purchase_request_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS audit_row_change ON public.purchase_requests;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.purchase_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('purchase');

-- 2. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purchase_request_is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.gate_pass_has_any_role(ARRAY['super_admin']); $$;

-- Is the caller a head of this department? (Super admin may act for any.)
CREATE OR REPLACE FUNCTION public.purchase_request_is_dept_head(p_department_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.purchase_request_is_super_admin()
      OR EXISTS (SELECT 1 FROM public.purchase_request_department_heads h
                  WHERE h.department_id = p_department_id AND h.user_id = public.app_user_id());
$$;

-- Can the caller give the purchase approval for this category?
-- Mirrors hasPurchaseCategoryPermission(category, 'approve') in AuthContext,
-- without the QC inspector (who approves inspections, not purchases).
CREATE OR REPLACE FUNCTION public.purchase_request_can_purchase_approve(p_category public.purchase_category)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(ARRAY['super_admin','purchase_manager'])
      OR EXISTS (SELECT 1 FROM public.purchase_category_permissions p
                  WHERE p.user_id = public.app_user_id() AND p.category = p_category
                    AND COALESCE(p.can_approve, false));
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_log(
  p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.purchase_request_events (request_id, event, message, details, created_by)
  VALUES (p_id, p_event, p_message, p_details, public.app_user_id());
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_category_label(p_category public.purchase_category)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_category
    WHEN 'office_supplies' THEN 'Office Supplies'
    WHEN 'raw_material' THEN 'Raw Material'
    WHEN 'general_supplies' THEN 'Production Supplies'
    WHEN 'spare_maintenance' THEN 'Spares & Parts'
    ELSE p_category::text END;
$$;

-- "PRQ-000012 · Spares & Parts · Maintenance"
CREATE OR REPLACE FUNCTION public.purchase_request_label(p_req public.purchase_requests)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_req.pr_number || ' · ' || public.purchase_request_category_label(p_req.category)
      || COALESCE(' · ' || (SELECT d.name FROM public.production_departments d WHERE d.id = p_req.department_id), '')
      || CASE WHEN p_req.priority = 'urgent' THEN ' · URGENT' ELSE '' END;
$$;

-- Notify one stage's audience; never the actor.
--   'requester' the person who raised it
--   'hod'       the heads of its department
--   'purchase'  purchase managers and the category's approvers
--   'final'     super admins
--   'buyers'    purchase officers and managers (approved, ready to order)
CREATE OR REPLACE FUNCTION public.purchase_request_notify(
  p_req public.purchase_requests, p_audience text, p_title text, p_message text, p_type text DEFAULT 'info'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_self_link text := '/my-purchase-requests/' || p_req.id::text;
  v_purchase_link text := '/purchase/requests/' || p_req.id::text;
  r record;
BEGIN
  IF p_audience = 'requester' THEN
    IF p_req.created_by IS NOT NULL AND p_req.created_by IS DISTINCT FROM v_uid THEN
      PERFORM public.notify_user(p_req.created_by, p_title, p_message, p_type,
        'purchase', v_self_link, 'purchase_request', p_req.id, v_uid);
    END IF;
  ELSIF p_audience = 'hod' THEN
    FOR r IN
      SELECT h.user_id FROM public.purchase_request_department_heads h
        JOIN public.app_users u ON u.id = h.user_id
       WHERE h.department_id = p_req.department_id AND u.is_active
         AND h.user_id IS DISTINCT FROM v_uid
    LOOP
      PERFORM public.notify_user(r.user_id, p_title, p_message, p_type,
        'purchase', v_self_link, 'purchase_request', p_req.id, v_uid);
    END LOOP;
  ELSIF p_audience = 'purchase' THEN
    FOR r IN
      SELECT DISTINCT u.id AS user_id
        FROM public.app_users u
       WHERE u.is_active AND u.id IS DISTINCT FROM v_uid
         AND u.id IS DISTINCT FROM p_req.created_by
         AND (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.role::text = 'purchase_manager')
              OR EXISTS (SELECT 1 FROM public.purchase_category_permissions p
                          WHERE p.user_id = u.id AND p.category = p_req.category AND COALESCE(p.can_approve, false)))
    LOOP
      PERFORM public.notify_user(r.user_id, p_title, p_message, p_type,
        'purchase', v_purchase_link, 'purchase_request', p_req.id, v_uid);
    END LOOP;
  ELSIF p_audience = 'final' THEN
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[], p_title, p_message, p_type,
      'purchase', v_purchase_link, 'purchase_request', p_req.id, v_uid, v_uid);
  ELSIF p_audience = 'buyers' THEN
    PERFORM public.notify_role(ARRAY['purchase_officer','purchase_manager']::app_role[], p_title, p_message, p_type,
      'purchase', v_purchase_link, 'purchase_request', p_req.id, v_uid, v_uid);
  END IF;
END;
$$;

-- Σ approved (or requested, before any approval) qty × estimated rate.
CREATE OR REPLACE FUNCTION public.purchase_request_recalc(p_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_total numeric;
BEGIN
  SELECT COALESCE(round(sum(COALESCE(approved_qty, requested_qty) * est_rate), 2), 0)
    INTO v_total FROM public.purchase_request_items WHERE request_id = p_id;
  UPDATE public.purchase_requests SET estimated_total = v_total, updated_at = now() WHERE id = p_id;
  RETURN v_total;
END;
$$;

-- Apply approver quantity (and, for purchase, rate) changes.
-- p_lines: [{ id, approved_qty, est_rate? }]. Lines not listed keep their
-- current approved qty (or the requested qty when none yet). A quantity may be
-- lowered, never raised above what was requested; 0 drops the line.
-- Returns the number of lines still wanted (approved qty > 0).
CREATE OR REPLACE FUNCTION public.purchase_request_apply_lines(p_id uuid, p_lines jsonb, p_allow_rate boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  x jsonb;
  l public.purchase_request_items%ROWTYPE;
  v_qty numeric;
  v_rate numeric;
  v_left integer;
BEGIN
  UPDATE public.purchase_request_items
     SET approved_qty = COALESCE(approved_qty, requested_qty)
   WHERE request_id = p_id;

  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    SELECT * INTO l FROM public.purchase_request_items
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
      UPDATE public.purchase_request_items SET approved_qty = v_qty WHERE id = l.id;
    END IF;
    IF p_allow_rate AND x ? 'est_rate' THEN
      v_rate := NULLIF(x->>'est_rate', '')::numeric;
      IF v_rate IS NULL OR v_rate < 0 THEN
        RAISE EXCEPTION 'Line %: enter an estimated rate of 0 or more.', l.line_no;
      END IF;
      UPDATE public.purchase_request_items SET est_rate = v_rate WHERE id = l.id;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_left FROM public.purchase_request_items
   WHERE request_id = p_id AND approved_qty > 0;
  RETURN v_left;
END;
$$;

-- Raise unless the request can reach a department head: the caller is a head
-- of the department, or it has at least one active head.
CREATE OR REPLACE FUNCTION public.purchase_request_assert_head(p_department_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.purchase_request_department_heads h
               JOIN public.app_users u ON u.id = h.user_id
              WHERE h.department_id = p_department_id
                AND (u.is_active OR h.user_id = public.app_user_id())) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'No department head is set for %. Ask a super admin to set one (Purchase → Purchase Requests → Department heads).',
    COALESCE((SELECT name FROM public.production_departments WHERE id = p_department_id), 'this department');
END;
$$;

-- 3. Raise ---------------------------------------------------------------------

-- Create or edit a draft. p_data:
--   { category, department_id, priority, required_by, purpose, machine_id,
--     is_breakdown, job_order_ref,
--     lines: [{ item_id, requested_qty, remarks }] }
-- p_submit = true also submits it.
CREATE OR REPLACE FUNCTION public.purchase_request_save(p_id uuid, p_data jsonb, p_submit boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_old public.purchase_requests%ROWTYPE;
  v_id uuid := p_id;
  v_category public.purchase_category;
  v_department uuid := NULLIF(p_data->>'department_id', '')::uuid;
  v_priority text := COALESCE(NULLIF(p_data->>'priority', ''), 'normal');
  v_required date := NULLIF(p_data->>'required_by', '')::date;
  v_purpose text := NULLIF(btrim(p_data->>'purpose'), '');
  v_machine uuid := NULLIF(p_data->>'machine_id', '')::uuid;
  v_breakdown boolean := COALESCE((p_data->>'is_breakdown')::boolean, false);
  v_job text := NULLIF(btrim(p_data->>'job_order_ref'), '');
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  x jsonb;
  it record;
  v_qty numeric;
  v_n integer := 0;
  v_seen uuid[] := ARRAY[]::uuid[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Log in again to raise a purchase request.';
  END IF;
  BEGIN
    v_category := (p_data->>'category')::public.purchase_category;
  EXCEPTION WHEN OTHERS THEN
    v_category := NULL;
  END;
  IF v_category IS NULL THEN
    RAISE EXCEPTION 'Choose the category.';
  END IF;
  IF v_department IS NULL OR NOT EXISTS (SELECT 1 FROM public.production_departments WHERE id = v_department) THEN
    RAISE EXCEPTION 'Choose the department.';
  END IF;
  IF v_priority NOT IN ('normal','urgent') THEN
    RAISE EXCEPTION 'Choose Normal or Urgent.';
  END IF;
  IF v_purpose IS NULL THEN
    RAISE EXCEPTION 'Write what the items are needed for.';
  END IF;
  IF v_required IS NOT NULL AND v_required < v_today THEN
    RAISE EXCEPTION 'The required-by date cannot be in the past.';
  END IF;
  IF v_category <> 'spare_maintenance' THEN
    v_machine := NULL;
    v_breakdown := false;
  END IF;
  IF v_breakdown THEN
    v_priority := 'urgent';
  END IF;
  IF v_category <> 'raw_material' THEN
    v_job := NULL;
  END IF;
  IF jsonb_typeof(COALESCE(p_data->'lines', 'null'::jsonb)) <> 'array'
     OR jsonb_array_length(p_data->'lines') = 0 THEN
    RAISE EXCEPTION 'Add at least one item.';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.purchase_requests WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Purchase request not found.';
    END IF;
    IF v_old.status <> 'draft' THEN
      RAISE EXCEPTION 'Purchase request % is % and can no longer be edited.', v_old.pr_number, replace(v_old.status, '_', ' ');
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Only the person who raised this request can edit it.';
    END IF;
    UPDATE public.purchase_requests
       SET category = v_category, department_id = v_department, priority = v_priority,
           required_by = v_required, purpose = v_purpose, machine_id = v_machine,
           is_breakdown = v_breakdown, job_order_ref = v_job, updated_at = now()
     WHERE id = v_id;
    DELETE FROM public.purchase_request_items WHERE request_id = v_id;
  ELSE
    INSERT INTO public.purchase_requests
      (pr_number, category, department_id, priority, required_by, purpose, machine_id,
       is_breakdown, job_order_ref, created_by)
    VALUES
      ('NEW-' || gen_random_uuid()::text, v_category, v_department, v_priority, v_required, v_purpose,
       v_machine, v_breakdown, v_job, v_uid)
    RETURNING id INTO v_id;
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_data->'lines') LOOP
    SELECT i.id, i.code, i.name, i.category, COALESCE(i.is_active, true) AS is_active, COALESCE(i.unit_price, 0) AS unit_price
      INTO it FROM public.items i WHERE i.id = NULLIF(x->>'item_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Line %: choose an item from the item master.', v_n + 1;
    END IF;
    IF NOT it.is_active THEN
      RAISE EXCEPTION 'Item % % is not active.', it.code, it.name;
    END IF;
    IF it.category IS DISTINCT FROM v_category THEN
      RAISE EXCEPTION 'Item % % is not a % item.', it.code, it.name, public.purchase_request_category_label(v_category);
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
    INSERT INTO public.purchase_request_items (request_id, line_no, item_id, requested_qty, est_rate, remarks)
    VALUES (v_id, v_n, it.id, v_qty, it.unit_price, NULLIF(btrim(x->>'remarks'), ''));
  END LOOP;

  -- The number is given only once every check has passed, so a failed save
  -- never uses one up and the series stays without gaps.
  IF p_submit THEN
    PERFORM public.purchase_request_assert_head(v_department);
  END IF;
  IF p_id IS NULL THEN
    UPDATE public.purchase_requests
       SET pr_number = 'PRQ-' || lpad(nextval('public.purchase_request_number_seq')::text, 6, '0')
     WHERE id = v_id;
  END IF;

  PERFORM public.purchase_request_recalc(v_id);
  PERFORM public.purchase_request_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END,
    v_n || ' item(s)');

  IF p_submit THEN
    PERFORM public.purchase_request_submit(v_id);
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_submit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.purchase_requests%ROWTYPE;
  v_self_head boolean;
BEGIN
  SELECT * INTO r FROM public.purchase_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase request not found.';
  END IF;
  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'Purchase request % has already been submitted.', r.pr_number;
  END IF;
  IF r.created_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Only the person who raised this request can submit it.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.purchase_request_items WHERE request_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one item.';
  END IF;

  v_self_head := EXISTS (SELECT 1 FROM public.purchase_request_department_heads h
                          WHERE h.department_id = r.department_id AND h.user_id = v_uid);

  IF v_self_head THEN
    UPDATE public.purchase_requests
       SET status = 'pending_purchase', submitted_at = now(),
           hod_by = v_uid, hod_at = now(), hod_remarks = 'Raised by the department head', updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.purchase_request_log(p_id, 'submitted');
    PERFORM public.purchase_request_log(p_id, 'hod_approved', 'Passed automatically: raised by the department head');
    PERFORM public.purchase_request_notify(r, 'purchase', 'Purchase request needs purchase approval',
      public.purchase_request_label(r) || ': ' || r.purpose);
    RETURN r.status;
  END IF;

  PERFORM public.purchase_request_assert_head(r.department_id);

  UPDATE public.purchase_requests
     SET status = 'pending_hod', submitted_at = now(), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.purchase_request_log(p_id, 'submitted');
  PERFORM public.purchase_request_notify(r, 'hod', 'Purchase request needs your approval',
    public.purchase_request_label(r) || ': ' || r.purpose);
  RETURN r.status;
END;
$$;

-- 4. Approvals -----------------------------------------------------------------

-- Department head. p_lines: [{ id, approved_qty }] (optional).
CREATE OR REPLACE FUNCTION public.purchase_request_hod_review(
  p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL, p_lines jsonb DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.purchase_requests%ROWTYPE;
  v_remarks text := NULLIF(btrim(p_remarks), '');
BEGIN
  SELECT * INTO r FROM public.purchase_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase request not found.';
  END IF;
  IF r.status <> 'pending_hod' THEN
    RAISE EXCEPTION 'Purchase request % is not waiting for the department head.', r.pr_number;
  END IF;
  IF NOT public.purchase_request_is_dept_head(r.department_id) THEN
    RAISE EXCEPTION 'Only a head of this department can approve or reject this request.';
  END IF;

  IF NOT p_approve THEN
    IF v_remarks IS NULL THEN
      RAISE EXCEPTION 'Give a reason for rejecting the request.';
    END IF;
    UPDATE public.purchase_requests
       SET status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_remarks,
           hod_by = v_uid, hod_at = now(), hod_remarks = v_remarks, updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.purchase_request_log(p_id, 'hod_rejected', v_remarks);
    PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request rejected',
      public.purchase_request_label(r) || ' — rejected by the department head: ' || v_remarks, 'warning');
    RETURN r.status;
  END IF;

  IF public.purchase_request_apply_lines(p_id, p_lines, false) = 0 THEN
    RAISE EXCEPTION 'Every quantity is 0 — reject the request instead.';
  END IF;
  PERFORM public.purchase_request_recalc(p_id);
  UPDATE public.purchase_requests
     SET status = 'pending_purchase', hod_by = v_uid, hod_at = now(), hod_remarks = v_remarks, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.purchase_request_log(p_id, 'hod_approved', v_remarks);
  PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request approved by department head',
    public.purchase_request_label(r) || ' — now with Purchase.', 'success');
  PERFORM public.purchase_request_notify(r, 'purchase', 'Purchase request needs purchase approval',
    public.purchase_request_label(r) || ': ' || r.purpose);
  RETURN r.status;
END;
$$;

-- Purchase approver for the category. p_lines: [{ id, approved_qty, est_rate }].
CREATE OR REPLACE FUNCTION public.purchase_request_purchase_review(
  p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL, p_lines jsonb DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.purchase_requests%ROWTYPE;
  v_remarks text := NULLIF(btrim(p_remarks), '');
  v_total numeric;
  v_limit numeric;
BEGIN
  SELECT * INTO r FROM public.purchase_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase request not found.';
  END IF;
  IF r.status <> 'pending_purchase' THEN
    RAISE EXCEPTION 'Purchase request % is not waiting for purchase approval.', r.pr_number;
  END IF;
  IF NOT public.purchase_request_can_purchase_approve(r.category) THEN
    RAISE EXCEPTION 'You cannot approve % purchase requests.', public.purchase_request_category_label(r.category);
  END IF;
  IF r.created_by = v_uid AND NOT public.purchase_request_is_super_admin() THEN
    RAISE EXCEPTION 'You cannot give the purchase approval on your own request.';
  END IF;

  IF NOT p_approve THEN
    IF v_remarks IS NULL THEN
      RAISE EXCEPTION 'Give a reason for rejecting the request.';
    END IF;
    UPDATE public.purchase_requests
       SET status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_remarks,
           purchase_by = v_uid, purchase_at = now(), purchase_remarks = v_remarks, updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.purchase_request_log(p_id, 'purchase_rejected', v_remarks);
    PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request rejected',
      public.purchase_request_label(r) || ' — rejected by Purchase: ' || v_remarks, 'warning');
    RETURN r.status;
  END IF;

  IF public.purchase_request_apply_lines(p_id, p_lines, true) = 0 THEN
    RAISE EXCEPTION 'Every quantity is 0 — reject the request instead.';
  END IF;
  v_total := public.purchase_request_recalc(p_id);
  SELECT approval_limit INTO v_limit FROM public.purchase_request_settings WHERE id;
  v_limit := COALESCE(v_limit, 0);

  IF v_total > v_limit THEN
    UPDATE public.purchase_requests
       SET status = 'pending_final', needs_final_approval = true,
           purchase_by = v_uid, purchase_at = now(), purchase_remarks = v_remarks, updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.purchase_request_log(p_id, 'purchase_approved', v_remarks,
      jsonb_build_object('estimated_total', v_total, 'approval_limit', v_limit));
    PERFORM public.purchase_request_notify(r, 'final', 'Purchase request above the limit needs your approval',
      public.purchase_request_label(r) || ' — estimated ' || to_char(v_total, 'FM999,999,999,990.00')
        || ' (limit ' || to_char(v_limit, 'FM999,999,999,990.00') || ')');
    PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request approved by Purchase',
      public.purchase_request_label(r) || ' — above the value limit, now waiting for final approval.');
  ELSE
    UPDATE public.purchase_requests
       SET status = 'approved', needs_final_approval = false,
           purchase_by = v_uid, purchase_at = now(), purchase_remarks = v_remarks, updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.purchase_request_log(p_id, 'purchase_approved', v_remarks,
      jsonb_build_object('estimated_total', v_total, 'approval_limit', v_limit));
    PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request approved',
      public.purchase_request_label(r) || ' — Purchase will now order the items.', 'success');
    PERFORM public.purchase_request_notify(r, 'buyers', 'Purchase request approved — ready to order',
      public.purchase_request_label(r), 'success');
  END IF;
  RETURN r.status;
END;
$$;

-- Super admin, for requests above the approval limit.
CREATE OR REPLACE FUNCTION public.purchase_request_final_review(
  p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.purchase_requests%ROWTYPE;
  v_remarks text := NULLIF(btrim(p_remarks), '');
BEGIN
  IF NOT public.purchase_request_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can give the final approval.';
  END IF;
  SELECT * INTO r FROM public.purchase_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase request not found.';
  END IF;
  IF r.status <> 'pending_final' THEN
    RAISE EXCEPTION 'Purchase request % is not waiting for final approval.', r.pr_number;
  END IF;

  IF NOT p_approve THEN
    IF v_remarks IS NULL THEN
      RAISE EXCEPTION 'Give a reason for rejecting the request.';
    END IF;
    UPDATE public.purchase_requests
       SET status = 'rejected', rejected_by = v_uid, rejected_at = now(), reject_reason = v_remarks,
           final_by = v_uid, final_at = now(), final_remarks = v_remarks, updated_at = now()
     WHERE id = p_id RETURNING * INTO r;
    PERFORM public.purchase_request_log(p_id, 'final_rejected', v_remarks);
    PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request rejected',
      public.purchase_request_label(r) || ' — rejected at final approval: ' || v_remarks, 'warning');
    PERFORM public.purchase_request_notify(r, 'purchase', 'Purchase request rejected at final approval',
      public.purchase_request_label(r) || ': ' || v_remarks, 'warning');
    RETURN r.status;
  END IF;

  UPDATE public.purchase_requests
     SET status = 'approved', final_by = v_uid, final_at = now(), final_remarks = v_remarks, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.purchase_request_log(p_id, 'final_approved', v_remarks);
  PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request approved',
    public.purchase_request_label(r) || ' — Purchase will now order the items.', 'success');
  PERFORM public.purchase_request_notify(r, 'buyers', 'Purchase request approved — ready to order',
    public.purchase_request_label(r), 'success');
  RETURN r.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.purchase_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_manager boolean := public.gate_pass_has_any_role(ARRAY['super_admin','purchase_manager']);
BEGIN
  SELECT * INTO r FROM public.purchase_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase request not found.';
  END IF;
  IF r.status IN ('ordered','partially_ordered','rejected','cancelled') THEN
    RAISE EXCEPTION 'Purchase request % is % and cannot be cancelled.', r.pr_number, replace(r.status, '_', ' ');
  END IF;
  IF NOT (v_manager OR (r.created_by = v_uid AND r.status <> 'approved')) THEN
    RAISE EXCEPTION 'Only the person who raised it (before approval) or a purchase manager can cancel this request.';
  END IF;
  IF v_reason IS NULL AND r.status <> 'draft' THEN
    RAISE EXCEPTION 'Give a reason for cancelling the request.';
  END IF;

  UPDATE public.purchase_requests
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = v_reason, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.purchase_request_log(p_id, 'cancelled', v_reason);
  PERFORM public.purchase_request_notify(r, 'requester', 'Purchase request cancelled',
    public.purchase_request_label(r) || COALESCE(': ' || v_reason, ''), 'warning');
END;
$$;

-- 5. Settings --------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.purchase_request_settings_save(p_approval_limit numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.purchase_request_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change the purchase request settings.';
  END IF;
  IF p_approval_limit IS NULL OR p_approval_limit < 0 THEN
    RAISE EXCEPTION 'Enter an approval limit of 0 or more.';
  END IF;
  UPDATE public.purchase_request_settings
     SET approval_limit = p_approval_limit, updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- Replace the heads of one department.
CREATE OR REPLACE FUNCTION public.purchase_request_set_department_heads(p_department_id uuid, p_user_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.purchase_request_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can set department heads.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_departments WHERE id = p_department_id) THEN
    RAISE EXCEPTION 'Department not found.';
  END IF;
  DELETE FROM public.purchase_request_department_heads
   WHERE department_id = p_department_id
     AND NOT (user_id = ANY (COALESCE(p_user_ids, ARRAY[]::uuid[])));
  INSERT INTO public.purchase_request_department_heads (department_id, user_id, created_by)
  SELECT p_department_id, u.id, public.app_user_id()
    FROM public.app_users u
   WHERE u.id = ANY (COALESCE(p_user_ids, ARRAY[]::uuid[]))
  ON CONFLICT (department_id, user_id) DO NOTHING;
END;
$$;

-- 6. Grants ----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.purchase_request_is_super_admin(),
  public.purchase_request_is_dept_head(uuid),
  public.purchase_request_can_purchase_approve(public.purchase_category),
  public.purchase_request_category_label(public.purchase_category),
  public.purchase_request_save(uuid, jsonb, boolean),
  public.purchase_request_submit(uuid),
  public.purchase_request_hod_review(uuid, boolean, text, jsonb),
  public.purchase_request_purchase_review(uuid, boolean, text, jsonb),
  public.purchase_request_final_review(uuid, boolean, text),
  public.purchase_request_cancel(uuid, text),
  public.purchase_request_settings_save(numeric),
  public.purchase_request_set_department_heads(uuid, uuid[])
  TO anon, authenticated, service_role;

-- Internal helpers: service role only.
REVOKE ALL ON FUNCTION
  public.purchase_request_assert_head(uuid),
  public.purchase_request_log(uuid, text, text, jsonb),
  public.purchase_request_label(public.purchase_requests),
  public.purchase_request_notify(public.purchase_requests, text, text, text, text),
  public.purchase_request_recalc(uuid),
  public.purchase_request_apply_lines(uuid, jsonb, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.purchase_request_assert_head(uuid),
  public.purchase_request_log(uuid, text, text, jsonb),
  public.purchase_request_label(public.purchase_requests),
  public.purchase_request_notify(public.purchase_requests, text, text, text, text),
  public.purchase_request_recalc(uuid),
  public.purchase_request_apply_lines(uuid, jsonb, boolean)
  TO service_role;
