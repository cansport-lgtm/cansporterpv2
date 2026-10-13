-- ============================================================================
-- Rejections & Wastages — Downgrades
-- ----------------------------------------------------------------------------
-- A downgrade form records the decision to sell / use an item at a lower grade
-- than it was made for (e.g. T → VM). The form has three parts:
--   1. Basic details   — name, department, item, quantity, original grade,
--                        proposed downgrade (grades come from public.grades).
--   2. Reason          — issue, why the original grade cannot be used, reason
--                        for converting.
--   3. Approval        — only a super admin approves or rejects.
--
-- Costing: downgrade loss = (original rate − downgraded rate) × quantity. The
-- rates are pre-filled on the form from Cheap Ball Rates (rw_defect_rates
-- standard cost for the grade) and can be edited; they are stored with the
-- form, so changing a rate later never rewrites a past loss.
--
-- A downgrade is a log only: nothing here touches stock, the ball ledger or
-- production quantities. An APPROVED form's loss is reported in R&W Analytics,
-- dated by the day it was approved (approved_on).
--
-- A rejected form is closed for good — the requester raises a new one.
--
-- The table is read-only to clients. Writes go through these SECURITY DEFINER
-- functions, which check the acting user's roles in the database:
--   rw_downgrade_submit(...)                   → jsonb {id, downgrade_no}
--   rw_downgrade_review(id, approve, notes)    → status
--   rw_downgrade_cancel(id)                    → void
--
-- Rollback: supabase/rollbacks/20261022120000_rw_downgrades_down.sql
-- ============================================================================

-- 1. Table ---------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.rw_downgrade_seq;

CREATE TABLE IF NOT EXISTS public.rw_downgrades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  downgrade_no text NOT NULL UNIQUE
    DEFAULT 'DG-' || lpad(nextval('public.rw_downgrade_seq')::text, 5, '0'),
  request_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Karachi')::date,

  -- 1. Basic details
  requester_name text NOT NULL,
  department_id uuid REFERENCES public.production_departments(id) ON DELETE SET NULL,
  department_name text,
  -- Set when the item was picked from the grades list; NULL for a typed item.
  item_grade_id uuid REFERENCES public.grades(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL DEFAULT 'pcs',
  original_grade_id uuid REFERENCES public.grades(id) ON DELETE SET NULL,
  original_grade_name text NOT NULL,
  proposed_grade_id uuid REFERENCES public.grades(id) ON DELETE SET NULL,
  proposed_grade_name text NOT NULL,

  -- 2. Reason for downgrading
  issue text NOT NULL,
  why_original_unusable text NOT NULL,
  reason_for_converting text NOT NULL,

  -- Costing (tracking only)
  original_rate numeric NOT NULL DEFAULT 0 CHECK (original_rate >= 0),
  downgraded_rate numeric NOT NULL DEFAULT 0 CHECK (downgraded_rate >= 0),
  cost_loss numeric GENERATED ALWAYS AS (GREATEST(original_rate - downgraded_rate, 0) * quantity) STORED,

  -- 3. Approval
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_notes text,
  -- The day the loss counts in analytics (Karachi date of approval).
  approved_on date,

  requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT rw_downgrades_grades_differ
    CHECK (original_grade_id IS NULL OR proposed_grade_id IS NULL OR original_grade_id <> proposed_grade_id),
  CONSTRAINT rw_downgrades_rate_not_higher CHECK (downgraded_rate <= original_rate)
);

CREATE INDEX IF NOT EXISTS rw_downgrades_status_idx ON public.rw_downgrades (status, created_at DESC);
CREATE INDEX IF NOT EXISTS rw_downgrades_approved_on_idx ON public.rw_downgrades (approved_on) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS rw_downgrades_request_date_idx ON public.rw_downgrades (request_date);
CREATE INDEX IF NOT EXISTS rw_downgrades_department_idx ON public.rw_downgrades (department_id);

DROP TRIGGER IF EXISTS update_rw_downgrades_updated_at ON public.rw_downgrades;
CREATE TRIGGER update_rw_downgrades_updated_at
  BEFORE UPDATE ON public.rw_downgrades
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Read for everyone with a login; no client writes (functions only).
ALTER TABLE public.rw_downgrades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read rw_downgrades" ON public.rw_downgrades;
CREATE POLICY "Read rw_downgrades" ON public.rw_downgrades FOR SELECT TO public USING (true);
REVOKE ALL ON public.rw_downgrades FROM anon, authenticated;
GRANT SELECT ON public.rw_downgrades TO anon, authenticated, service_role;
GRANT ALL ON public.rw_downgrades TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.rw_downgrade_seq TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS audit_row_change ON public.rw_downgrades;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.rw_downgrades
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('rejections_wastages');

-- 2. Helpers -------------------------------------------------------------------

-- request → raise a downgrade form (anyone working in R&W)
-- approve → approve / reject (super admin only)
CREATE OR REPLACE FUNCTION public.rw_downgrade_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE p_action
    WHEN 'request' THEN
      public.gate_pass_has_any_role(ARRAY['super_admin', 'admin', 'manager', 'supervisor',
                                          'operational_manager', 'floor_incharge',
                                          'rejections_manager', 'rejections_officer'])
      OR public.has_module_permission(public.app_user_id(), 'rejections_wastages', 'create')
    WHEN 'approve' THEN public.gate_pass_has_any_role(ARRAY['super_admin'])
    ELSE false END;
$$;

CREATE OR REPLACE FUNCTION public.rw_downgrade_notify(
  r public.rw_downgrades, p_title text, p_message text, p_type text,
  p_to_requester boolean, p_to_approvers boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
BEGIN
  IF p_to_approvers THEN
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[], p_title, p_message, p_type,
      'rejections_wastages', '/rejections/downgrade-approvals', 'rw_downgrade', r.id, v_uid, v_uid);
  END IF;
  IF p_to_requester AND r.requested_by IS NOT NULL AND r.requested_by IS DISTINCT FROM v_uid THEN
    PERFORM public.notify_user(r.requested_by, p_title, p_message, p_type,
      'rejections_wastages', '/rejections/downgrades', 'rw_downgrade', r.id, v_uid);
  END IF;
END;
$$;

-- 3. Actions -------------------------------------------------------------------

-- Raise a downgrade form. Returns {id, downgrade_no}.
CREATE OR REPLACE FUNCTION public.rw_downgrade_submit(
  p_requester_name text,
  p_department_id uuid,
  p_item_grade_id uuid,
  p_item_name text,
  p_quantity numeric,
  p_unit text,
  p_original_grade_id uuid,
  p_proposed_grade_id uuid,
  p_issue text,
  p_why_original_unusable text,
  p_reason_for_converting text,
  p_original_rate numeric,
  p_downgraded_rate numeric
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.rw_downgrades%ROWTYPE;
  v_name text := NULLIF(btrim(p_requester_name), '');
  v_item text := NULLIF(btrim(p_item_name), '');
  v_issue text := NULLIF(btrim(p_issue), '');
  v_why text := NULLIF(btrim(p_why_original_unusable), '');
  v_reason text := NULLIF(btrim(p_reason_for_converting), '');
  v_dept text;
  v_from text;
  v_to text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to raise a downgrade form.';
  END IF;
  IF NOT public.rw_downgrade_can('request') THEN
    RAISE EXCEPTION 'Your role cannot raise downgrade forms.';
  END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Enter the name.'; END IF;
  IF p_department_id IS NULL THEN RAISE EXCEPTION 'Pick the department.'; END IF;
  IF p_item_grade_id IS NOT NULL THEN
    SELECT name INTO v_item FROM public.grades WHERE id = p_item_grade_id;
  END IF;
  IF v_item IS NULL THEN RAISE EXCEPTION 'Enter the item name.'; END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN RAISE EXCEPTION 'Quantity must be more than 0.'; END IF;
  IF p_original_grade_id IS NULL OR p_proposed_grade_id IS NULL THEN
    RAISE EXCEPTION 'Pick both the original grade and the proposed downgrade.';
  END IF;
  IF p_original_grade_id = p_proposed_grade_id THEN
    RAISE EXCEPTION 'The proposed downgrade must be different from the original grade.';
  END IF;
  IF v_issue IS NULL OR v_why IS NULL OR v_reason IS NULL THEN
    RAISE EXCEPTION 'Fill in all three reasons: issue, why the original grade cannot be used, and reason for converting.';
  END IF;
  IF COALESCE(p_original_rate, 0) < 0 OR COALESCE(p_downgraded_rate, 0) < 0 THEN
    RAISE EXCEPTION 'Rates cannot be negative.';
  END IF;
  IF COALESCE(p_downgraded_rate, 0) > COALESCE(p_original_rate, 0) THEN
    RAISE EXCEPTION 'The downgraded rate cannot be higher than the original grade rate.';
  END IF;

  SELECT name INTO v_dept FROM public.production_departments WHERE id = p_department_id;
  IF v_dept IS NULL THEN RAISE EXCEPTION 'Department not found.'; END IF;
  SELECT name INTO v_from FROM public.grades WHERE id = p_original_grade_id;
  SELECT name INTO v_to FROM public.grades WHERE id = p_proposed_grade_id;
  IF v_from IS NULL OR v_to IS NULL THEN RAISE EXCEPTION 'Grade not found.'; END IF;

  INSERT INTO public.rw_downgrades (
    requester_name, department_id, department_name, item_grade_id, item_name, quantity, unit,
    original_grade_id, original_grade_name, proposed_grade_id, proposed_grade_name,
    issue, why_original_unusable, reason_for_converting,
    original_rate, downgraded_rate, requested_by)
  VALUES (
    v_name, p_department_id, v_dept, p_item_grade_id, v_item, p_quantity, COALESCE(NULLIF(btrim(p_unit), ''), 'pcs'),
    p_original_grade_id, v_from, p_proposed_grade_id, v_to,
    v_issue, v_why, v_reason,
    COALESCE(p_original_rate, 0), COALESCE(p_downgraded_rate, 0), v_uid)
  RETURNING * INTO r;

  PERFORM public.rw_downgrade_notify(r,
    'Downgrade form ' || r.downgrade_no,
    r.requester_name || ' (' || v_dept || ') asks to downgrade ' || r.quantity || ' ' || r.unit
      || ' ' || r.item_name || ' from ' || v_from || ' to ' || v_to
      || ' — loss Rs. ' || to_char(r.cost_loss, 'FM999,999,999,990'),
    'warning', false, true);

  RETURN jsonb_build_object('id', r.id, 'downgrade_no', r.downgrade_no);
END;
$$;

-- The super admin approves or rejects (a remark is required to reject).
CREATE OR REPLACE FUNCTION public.rw_downgrade_review(p_id uuid, p_approve boolean, p_notes text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.rw_downgrades%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  v_notes text := NULLIF(btrim(p_notes), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to review this form.';
  END IF;
  IF NOT public.rw_downgrade_can('approve') THEN
    RAISE EXCEPTION 'Only a super admin can approve or reject downgrade forms.';
  END IF;

  SELECT * INTO r FROM public.rw_downgrades WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Downgrade form not found.';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Downgrade form % is not waiting for approval (it is %).', r.downgrade_no, r.status;
  END IF;
  IF NOT p_approve AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Add a remark to explain the rejection.';
  END IF;

  UPDATE public.rw_downgrades
     SET status = v_status, reviewed_by = v_uid,
         reviewed_by_name = (SELECT full_name FROM public.app_users WHERE id = v_uid),
         reviewed_at = now(), review_notes = v_notes,
         approved_on = CASE WHEN p_approve THEN (now() AT TIME ZONE 'Asia/Karachi')::date END
   WHERE id = p_id
  RETURNING * INTO r;

  PERFORM public.rw_downgrade_notify(r,
    'Downgrade form ' || r.downgrade_no || ' ' || v_status,
    CASE WHEN p_approve
      THEN r.item_name || ' ' || r.original_grade_name || ' → ' || r.proposed_grade_name || ' approved.'
           || COALESCE(' ' || v_notes, '')
      ELSE 'Rejected: ' || v_notes || ' Raise a new form if the downgrade is still needed.' END,
    CASE WHEN p_approve THEN 'success' ELSE 'error' END, true, false);

  RETURN v_status;
END;
$$;

-- The requester (or a super admin) withdraws a form still waiting for approval.
CREATE OR REPLACE FUNCTION public.rw_downgrade_cancel(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.rw_downgrades%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to cancel this form.';
  END IF;
  SELECT * INTO r FROM public.rw_downgrades WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Downgrade form not found.';
  END IF;
  IF r.requested_by IS DISTINCT FROM v_uid AND NOT public.rw_downgrade_can('approve') THEN
    RAISE EXCEPTION 'Only the person who raised this form can cancel it.';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Downgrade form % can no longer be cancelled (it is %).', r.downgrade_no, r.status;
  END IF;
  UPDATE public.rw_downgrades SET status = 'cancelled' WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rw_downgrade_notify(public.rw_downgrades, text, text, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rw_downgrade_can(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rw_downgrade_submit(text, uuid, uuid, text, numeric, text, uuid, uuid, text, text, text, numeric, numeric)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rw_downgrade_review(uuid, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rw_downgrade_cancel(uuid) TO anon, authenticated, service_role;
