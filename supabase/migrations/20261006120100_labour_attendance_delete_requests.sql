-- ============================================================================
-- Labour Attendance Delete Requests
-- ----------------------------------------------------------------------------
-- A worker's attendance for a day is the daily entry row in
-- labour_productivity_targets (one per worker / date / department / process).
-- When a supervisor marks a worker present by mistake (the worker was absent),
-- the supervisor cannot delete that row: only a super admin can. Instead the
-- supervisor raises a DELETE REQUEST with a reason. The request goes to the
-- labour_attendance_delete_approver (or a super admin), who approves it — which
-- deletes the entry — or rejects it with a note.
--
-- Everything is kept for the log sheet:
--   • labour_attendance_delete_requests — one row per request, with a full
--     snapshot of the entry as it was when the request was raised (the entry
--     itself is gone once the request is approved).
--   • labour_attendance_delete_log      — one row per event (submitted,
--     approved, rejected, cancelled, entry deleted directly), the "log sheet".
--
-- The tables are read-only to clients. Writes go through the SECURITY DEFINER
-- functions below, which check the acting user's roles in the database:
--   labour_attendance_delete_request(entry_id, reason)      → uuid
--   labour_attendance_delete_review(request_id, approve, notes) → status
--   labour_attendance_delete_cancel(request_id)             → void
--
-- Role: 20261006120000_labour_attendance_delete_roles.sql.
-- Rollback: supabase/rollbacks/20261006120100_labour_attendance_delete_requests_down.sql
-- ============================================================================

-- 1. Tables --------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.labour_attendance_delete_request_seq;

CREATE TABLE IF NOT EXISTS public.labour_attendance_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE
    DEFAULT 'ADR-' || lpad(nextval('public.labour_attendance_delete_request_seq')::text, 6, '0'),

  -- The entry asked to be deleted. Deliberately NOT a foreign key: the row is
  -- removed on approval and the request must survive it as the record.
  entry_id uuid NOT NULL,

  -- Snapshot of the entry when the request was raised.
  employee_id uuid REFERENCES public.labour_employees(id) ON DELETE SET NULL,
  employee_code text,
  employee_name text,
  target_date date NOT NULL,
  department_id uuid,
  department_name text,
  process_id uuid,
  process_name text,
  shift text,
  work_type text,
  mph numeric,
  check_in time,
  check_out time,
  target_quantity numeric,
  actual_quantity numeric,
  entry_status text,
  entry_created_by uuid,
  entry_created_by_name text,
  entry_created_at timestamptz,
  entry_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,

  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),

  requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  requested_by_name text,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_notes text,
  -- When the entry row was actually removed (by this approval, or directly by a
  -- super admin while the request was still pending).
  entry_deleted_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open request per entry.
CREATE UNIQUE INDEX IF NOT EXISTS labour_attendance_delete_requests_one_pending
  ON public.labour_attendance_delete_requests (entry_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS labour_attendance_delete_requests_status_idx
  ON public.labour_attendance_delete_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS labour_attendance_delete_requests_employee_idx
  ON public.labour_attendance_delete_requests (employee_id, target_date);
CREATE INDEX IF NOT EXISTS labour_attendance_delete_requests_requested_by_idx
  ON public.labour_attendance_delete_requests (requested_by, created_at DESC);

DROP TRIGGER IF EXISTS update_labour_attendance_delete_requests_updated_at
  ON public.labour_attendance_delete_requests;
CREATE TRIGGER update_labour_attendance_delete_requests_updated_at
  BEFORE UPDATE ON public.labour_attendance_delete_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- The log sheet: one row per event, denormalised so it reads on its own.
CREATE TABLE IF NOT EXISTS public.labour_attendance_delete_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.labour_attendance_delete_requests(id) ON DELETE CASCADE,
  request_number text NOT NULL,
  event text NOT NULL
    CHECK (event IN ('submitted', 'approved', 'rejected', 'cancelled', 'entry_deleted')),
  entry_id uuid,
  employee_id uuid,
  employee_code text,
  employee_name text,
  target_date date NOT NULL,
  department_name text,
  process_name text,
  work_type text,
  check_in time,
  check_out time,
  reason text,
  notes text,
  acted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  acted_by_name text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS labour_attendance_delete_log_created_idx
  ON public.labour_attendance_delete_log (created_at DESC);
CREATE INDEX IF NOT EXISTS labour_attendance_delete_log_request_idx
  ON public.labour_attendance_delete_log (request_id, created_at);
CREATE INDEX IF NOT EXISTS labour_attendance_delete_log_date_idx
  ON public.labour_attendance_delete_log (target_date);

-- Read for everyone with a login; no client writes (functions only).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['labour_attendance_delete_requests', 'labour_attendance_delete_log'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.labour_attendance_delete_request_seq TO anon, authenticated, service_role;

-- Audit trail like the other labour tables.
DROP TRIGGER IF EXISTS audit_row_change ON public.labour_attendance_delete_requests;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.labour_attendance_delete_requests
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('labour');

-- 2. Helpers -------------------------------------------------------------------

-- request → raise a delete request (the supervisors who post daily entries)
-- approve → approve / reject any request
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'request' THEN ARRAY['super_admin', 'admin', 'manager', 'supervisor', 'operational_manager',
                              'floor_incharge', 'labour_productivity_approver', 'labour_productivity_poster',
                              'labour_attendance_delete_approver']
    WHEN 'approve' THEN ARRAY['super_admin', 'labour_attendance_delete_approver']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.labour_attendance_delete_user_name(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT full_name FROM public.app_users WHERE id = p_user_id;
$$;

-- "ADR-000012 · W-041 Ali Khan · 03 Oct 2026"
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_label(r public.labour_attendance_delete_requests)
RETURNS text LANGUAGE sql STABLE
AS $$
  SELECT r.request_number || ' · ' || concat_ws(' ', r.employee_code, r.employee_name)
         || ' · ' || to_char(r.target_date, 'DD Mon YYYY');
$$;

CREATE OR REPLACE FUNCTION public.labour_attendance_delete_log_event(
  r public.labour_attendance_delete_requests, p_event text, p_notes text DEFAULT NULL,
  p_details jsonb DEFAULT NULL, p_actor uuid DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := COALESCE(p_actor, public.app_user_id());
BEGIN
  INSERT INTO public.labour_attendance_delete_log (
    request_id, request_number, event, entry_id, employee_id, employee_code, employee_name,
    target_date, department_name, process_name, work_type, check_in, check_out,
    reason, notes, acted_by, acted_by_name, details)
  VALUES (
    r.id, r.request_number, p_event, r.entry_id, r.employee_id, r.employee_code, r.employee_name,
    r.target_date, r.department_name, r.process_name, r.work_type, r.check_in, r.check_out,
    r.reason, NULLIF(btrim(p_notes), ''), v_actor, public.labour_attendance_delete_user_name(v_actor), p_details);
END;
$$;

-- Notify the approvers and / or the requester; never the actor.
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_notify(
  r public.labour_attendance_delete_requests, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_requester boolean DEFAULT true, p_to_approvers boolean DEFAULT true
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_link text := '/labour/attendance-delete-requests';
  v_roles text[] := ARRAY['super_admin', 'labour_attendance_delete_approver'];
BEGIN
  IF p_to_approvers THEN
    PERFORM public.notify_role(v_roles::app_role[], p_title, p_message, p_type,
      'labour', v_link, 'labour_attendance_delete_request', r.id, v_uid, v_uid);
  END IF;
  IF p_to_requester AND r.requested_by IS NOT NULL AND r.requested_by IS DISTINCT FROM v_uid
     AND NOT (p_to_approvers AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = r.requested_by AND role::text = ANY (v_roles))) THEN
    PERFORM public.notify_user(r.requested_by, p_title, p_message, p_type,
      'labour', v_link, 'labour_attendance_delete_request', r.id, v_uid);
  END IF;
END;
$$;

-- 3. Actions -------------------------------------------------------------------

-- A supervisor asks for an attendance entry to be deleted. Returns the request id.
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_request(p_entry_id uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  t public.labour_productivity_targets%ROWTYPE;
  e public.labour_employees%ROWTYPE;
  r public.labour_attendance_delete_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_dept text;
  v_proc text;
  v_other text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to raise a delete request.';
  END IF;
  IF NOT public.labour_attendance_delete_can('request') THEN
    RAISE EXCEPTION 'Your role cannot raise attendance delete requests.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give the reason for deleting this attendance (at least 5 characters).';
  END IF;

  SELECT * INTO t FROM public.labour_productivity_targets WHERE id = p_entry_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Attendance entry not found — it may already be deleted.';
  END IF;

  SELECT request_number INTO v_other
    FROM public.labour_attendance_delete_requests
   WHERE entry_id = p_entry_id AND status = 'pending';
  IF FOUND THEN
    RAISE EXCEPTION 'Delete request % is already pending for this entry.', v_other;
  END IF;

  SELECT * INTO e FROM public.labour_employees WHERE id = t.employee_id;
  SELECT name INTO v_dept FROM public.production_departments WHERE id = t.department_id;
  SELECT name INTO v_proc FROM public.qa_processes WHERE id = t.process_id;

  INSERT INTO public.labour_attendance_delete_requests (
    entry_id, employee_id, employee_code, employee_name, target_date,
    department_id, department_name, process_id, process_name,
    shift, work_type, mph, check_in, check_out, target_quantity, actual_quantity,
    entry_status, entry_created_by, entry_created_by_name, entry_created_at, entry_snapshot,
    reason, requested_by, requested_by_name)
  VALUES (
    t.id, t.employee_id, e.employee_code, e.full_name, t.target_date,
    t.department_id, v_dept, t.process_id, v_proc,
    t.shift, t.work_type, t.mph, t.check_in, t.check_out, t.target_quantity, t.actual_quantity,
    t.status, t.created_by, public.labour_attendance_delete_user_name(t.created_by), t.created_at, to_jsonb(t),
    v_reason, v_uid, public.labour_attendance_delete_user_name(v_uid))
  RETURNING * INTO r;

  PERFORM public.labour_attendance_delete_log_event(r, 'submitted', v_reason);
  PERFORM public.labour_attendance_delete_notify(r,
    'Attendance delete request ' || r.request_number,
    public.labour_attendance_delete_label(r) || ' — ' || COALESCE(r.requested_by_name, 'a supervisor')
      || ' asks to delete this attendance: ' || v_reason,
    'warning', false, true);
  RETURN r.id;
END;
$$;

-- The approver approves (the entry is deleted) or rejects (a note is required).
-- Returns the new status.
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_review(p_id uuid, p_approve boolean, p_notes text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.labour_attendance_delete_requests%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  v_notes text := NULLIF(btrim(p_notes), '');
  v_deleted integer := 0;
  v_already_gone boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to review this request.';
  END IF;
  IF NOT public.labour_attendance_delete_can('approve') THEN
    RAISE EXCEPTION 'Only the labour attendance delete approver can approve or reject delete requests.';
  END IF;

  SELECT * INTO r FROM public.labour_attendance_delete_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delete request not found.';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Delete request % is not waiting for approval (it is %).', r.request_number, r.status;
  END IF;
  IF NOT p_approve AND v_notes IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the request.';
  END IF;

  -- Mark the request first so the direct-delete trigger below leaves it alone.
  UPDATE public.labour_attendance_delete_requests
     SET status = v_status, reviewed_by = v_uid,
         reviewed_by_name = public.labour_attendance_delete_user_name(v_uid),
         reviewed_at = now(), review_notes = v_notes, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO r;

  IF p_approve THEN
    DELETE FROM public.labour_productivity_targets WHERE id = r.entry_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    v_already_gone := v_deleted = 0;
    UPDATE public.labour_attendance_delete_requests
       SET entry_deleted_at = COALESCE(entry_deleted_at, now())
     WHERE id = p_id
    RETURNING * INTO r;
  END IF;

  PERFORM public.labour_attendance_delete_log_event(r, v_status, v_notes,
    jsonb_build_object('entry_deleted', v_deleted > 0, 'entry_already_gone', v_already_gone));

  PERFORM public.labour_attendance_delete_notify(r,
    'Attendance delete request ' || v_status,
    public.labour_attendance_delete_label(r)
      || CASE WHEN p_approve THEN ' — attendance deleted' ELSE ' — request rejected' END
      || COALESCE(': ' || v_notes, ''),
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END, true, false);
  RETURN v_status;
END;
$$;

-- The supervisor who raised a request withdraws it while pending; an approver
-- may withdraw any pending request.
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.labour_attendance_delete_requests%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to cancel this request.';
  END IF;
  SELECT * INTO r FROM public.labour_attendance_delete_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delete request not found.';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'Delete request % is not pending (it is %).', r.request_number, r.status;
  END IF;
  IF r.requested_by IS DISTINCT FROM v_uid AND NOT public.labour_attendance_delete_can('approve') THEN
    RAISE EXCEPTION 'Only the supervisor who raised request % (or an approver) can cancel it.', r.request_number;
  END IF;

  UPDATE public.labour_attendance_delete_requests
     SET status = 'cancelled', reviewed_by = v_uid,
         reviewed_by_name = public.labour_attendance_delete_user_name(v_uid),
         reviewed_at = now(), review_notes = v_reason, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO r;

  PERFORM public.labour_attendance_delete_log_event(r, 'cancelled', v_reason);
  IF r.requested_by IS DISTINCT FROM v_uid THEN
    PERFORM public.labour_attendance_delete_notify(r,
      'Attendance delete request cancelled',
      public.labour_attendance_delete_label(r) || COALESCE(': ' || v_reason, ''),
      'info', true, false);
  END IF;
END;
$$;

-- 4. Direct deletes ------------------------------------------------------------

-- A super admin may still delete an entry directly. If a delete request was
-- pending for it, close the request as approved-by-direct-delete and log it so
-- the log sheet stays complete.
CREATE OR REPLACE FUNCTION public.labour_attendance_delete_on_entry_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.labour_attendance_delete_requests%ROWTYPE;
BEGIN
  FOR r IN
    SELECT * FROM public.labour_attendance_delete_requests
     WHERE entry_id = OLD.id AND status = 'pending'
     FOR UPDATE
  LOOP
    UPDATE public.labour_attendance_delete_requests
       SET status = 'approved', reviewed_by = v_uid,
           reviewed_by_name = public.labour_attendance_delete_user_name(v_uid),
           reviewed_at = now(), entry_deleted_at = now(),
           review_notes = 'Entry deleted directly' || COALESCE(' by ' || public.labour_attendance_delete_user_name(v_uid), ''),
           updated_at = now()
     WHERE id = r.id
    RETURNING * INTO r;
    PERFORM public.labour_attendance_delete_log_event(r, 'entry_deleted', r.review_notes,
      jsonb_build_object('direct_delete', true));
    PERFORM public.labour_attendance_delete_notify(r,
      'Attendance deleted',
      public.labour_attendance_delete_label(r) || ' — the entry was deleted directly; your request is closed.',
      'info', true, false);
  END LOOP;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS labour_attendance_delete_on_entry_delete ON public.labour_productivity_targets;
CREATE TRIGGER labour_attendance_delete_on_entry_delete
  AFTER DELETE ON public.labour_productivity_targets
  FOR EACH ROW EXECUTE FUNCTION public.labour_attendance_delete_on_entry_delete();

-- 5. Grants --------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.labour_attendance_delete_can(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labour_attendance_delete_request(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labour_attendance_delete_review(uuid, boolean, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.labour_attendance_delete_cancel(uuid, text) TO anon, authenticated, service_role;
