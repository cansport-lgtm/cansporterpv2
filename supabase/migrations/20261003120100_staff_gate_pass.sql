-- ============================================================================
-- Staff Gate Pass (HR staff leaving the premises during the day)
-- ----------------------------------------------------------------------------
-- Part of the HR module: the staff equivalent of the worker gate pass
-- (20261002120100_labour_gate_pass.sql). Staff passes have their own number
-- series SGP-000001 … (workers stay LGP-…, material passes GP-…).
--
-- Two kinds of pass:
--   half_day     The staff member leaves and does not come back today. When the
--                guard scans them out, that date is marked Half day in HR
--                attendance: the `attendance` row for that employee and date is
--                set (or created) with status 'half_day', check_out filled with
--                the gate-out time where blank, and a remark naming the pass.
--                A trigger on `attendance` keeps that date at half day whatever
--                is written later (Attendance page, Excel import). The Salary
--                Sheet, Attendance Sheet and Time Sheet read that row as they
--                do today: half a day unpaid, as for workers.
--   short_leave  The staff member goes out for a task and comes back. The guard
--                scans Out, later In. Out time, in time and the minutes outside
--                are recorded. Late return notifies the applicant and the
--                approvers. Still out at day end → 'not_returned' and, by
--                default, the day is marked Half day the same way.
--
-- Flow:
--   HR applies → pending_approval → approver approves → approved
--     → gate scan Out → out                   (half day: terminal)
--                        → gate scan In → returned   (short leave)
--   rejected / cancelled (before out) / expired (never scanned by day end)
--   / not_returned (short leave still out at day end)
--
-- One live pass (pending / approved / out) per staff member per day, enforced
-- by a partial unique index. A pass is valid at the gate only on its date.
--
-- Day end is the staff member's own duty_end_time (employees table), falling
-- back to the global setting when it is blank.
--
-- Roles (checked in staff_gate_pass_can):
--   apply   super_admin, staff_gate_pass_approver, hr_manager, hr_officer
--   approve super_admin, staff_gate_pass_approver
--   gate    super_admin, gate_pass_manager, gate_security  (Gate Check page)
--
-- All tables are read-only to clients: writes go through the SECURITY DEFINER
-- functions below. Every action is logged in staff_gate_pass_events.
-- A pg_cron job runs staff_gate_pass_tick() every 5 minutes: it sends the
-- overdue notices and closes the day (expire / not returned) after day end.
--
-- Also adds employees.photo_url and the staff-photos storage bucket so the
-- guard can compare the person with the photo, as for workers.
-- Rollback: supabase/rollbacks/20261003120100_staff_gate_pass_down.sql
-- ============================================================================

-- 0. Staff photo -------------------------------------------------------------

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS photo_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('staff-photos', 'staff-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Staff photos are publicly accessible" ON storage.objects;
CREATE POLICY "Staff photos are publicly accessible"
ON storage.objects FOR SELECT USING (bucket_id = 'staff-photos');

DROP POLICY IF EXISTS "Anyone can upload staff photos" ON storage.objects;
CREATE POLICY "Anyone can upload staff photos"
ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'staff-photos');

DROP POLICY IF EXISTS "Anyone can update staff photos" ON storage.objects;
CREATE POLICY "Anyone can update staff photos"
ON storage.objects FOR UPDATE USING (bucket_id = 'staff-photos');

DROP POLICY IF EXISTS "Anyone can delete staff photos" ON storage.objects;
CREATE POLICY "Anyone can delete staff photos"
ON storage.objects FOR DELETE USING (bucket_id = 'staff-photos');

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.staff_gate_pass_number_seq;

CREATE TABLE IF NOT EXISTS public.staff_gate_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_number text NOT NULL UNIQUE
    DEFAULT 'SGP-' || lpad(nextval('public.staff_gate_pass_number_seq')::text, 6, '0'),
  pass_kind text NOT NULL CHECK (pass_kind IN ('half_day','short_leave')),
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','out','returned','not_returned',
                      'expired','rejected','cancelled')),
  pass_date date NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.production_departments(id) ON DELETE SET NULL,
  reason text NOT NULL,
  -- short leave: how long the staff member is expected to be outside
  expected_minutes integer CHECK (expected_minutes IS NULL OR expected_minutes BETWEEN 5 AND 720),
  -- planned leaving time written by HR (information for the guard)
  leave_time time,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approval_remarks text,
  gate_out_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  gate_out_at timestamptz,
  expected_back_at timestamptz,
  gate_in_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  gate_in_at timestamptz,
  minutes_outside integer,
  overdue_notified_at timestamptz,
  half_day_marked_at timestamptz,
  half_day_rows integer,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  closed_at timestamptz,
  close_note text
);
CREATE INDEX IF NOT EXISTS staff_gate_passes_date_idx ON public.staff_gate_passes (pass_date DESC, status);
CREATE INDEX IF NOT EXISTS staff_gate_passes_employee_idx ON public.staff_gate_passes (employee_id, pass_date DESC);
CREATE INDEX IF NOT EXISTS staff_gate_passes_status_idx ON public.staff_gate_passes (status) WHERE status IN ('pending_approval','approved','out');
-- One live pass per staff member per day.
CREATE UNIQUE INDEX IF NOT EXISTS staff_gate_passes_live_uidx
  ON public.staff_gate_passes (employee_id, pass_date)
  WHERE status IN ('pending_approval','approved','out');
-- Dates marked Half day by a pass (used by the trigger and the sheets).
CREATE INDEX IF NOT EXISTS staff_gate_passes_half_day_idx
  ON public.staff_gate_passes (employee_id, pass_date)
  WHERE (pass_kind = 'half_day' AND status = 'out') OR status = 'not_returned';

CREATE TABLE IF NOT EXISTS public.staff_gate_pass_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id uuid NOT NULL REFERENCES public.staff_gate_passes(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_gate_pass_events_pass_idx ON public.staff_gate_pass_events (pass_id, created_at);
CREATE INDEX IF NOT EXISTS staff_gate_pass_events_rescan_idx
  ON public.staff_gate_pass_events (created_at DESC) WHERE event = 'rescan_attempt';

CREATE TABLE IF NOT EXISTS public.staff_gate_pass_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_expected_minutes integer NOT NULL DEFAULT 30 CHECK (default_expected_minutes BETWEEN 5 AND 720),
  grace_minutes integer NOT NULL DEFAULT 15 CHECK (grace_minutes BETWEEN 0 AND 240),
  -- Office time (Asia/Karachi). Used when the staff member has no duty_end_time.
  -- After day end, unused passes expire and short leaves still out become
  -- "not returned".
  day_end_time time NOT NULL DEFAULT '18:00',
  auto_half_day_not_returned boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.staff_gate_pass_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_gate_passes','staff_gate_pass_events','staff_gate_pass_settings'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- Audit trail like the other HR tables.
DROP TRIGGER IF EXISTS audit_row_change ON public.staff_gate_passes;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_gate_passes
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('hr');

-- 2. Views -------------------------------------------------------------------

-- Dates marked Half day by a staff gate pass (tooltips on the sheets, cards).
CREATE OR REPLACE VIEW public.v_staff_gate_pass_half_days AS
SELECT g.employee_id, g.pass_date, g.id AS pass_id, g.pass_number, g.pass_kind, g.status,
       g.gate_out_at, g.half_day_marked_at
  FROM public.staff_gate_passes g
 WHERE (g.pass_kind = 'half_day' AND g.status = 'out') OR g.status = 'not_returned';

GRANT SELECT ON public.v_staff_gate_pass_half_days TO anon, authenticated, service_role;

-- 3. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_gate_pass_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'apply'   THEN ARRAY['super_admin','staff_gate_pass_approver','hr_manager','hr_officer']
    WHEN 'approve' THEN ARRAY['super_admin','staff_gate_pass_approver']
    WHEN 'gate'    THEN ARRAY['super_admin','gate_pass_manager','gate_security']
    ELSE ARRAY[]::text[] END);
$$;

-- Today in office time.
CREATE OR REPLACE FUNCTION public.staff_gate_pass_today()
RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date; $$;

CREATE OR REPLACE FUNCTION public.staff_gate_pass_log(
  p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.staff_gate_pass_events (pass_id, event, message, details, created_by)
  VALUES (p_id, p_event, p_message, p_details, public.app_user_id());
$$;

-- "SGP-000012 (EMP-041 Ali Khan)"
CREATE OR REPLACE FUNCTION public.staff_gate_pass_label(p_pass public.staff_gate_passes)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_pass.pass_number || ' (' || e.employee_code || ' ' || e.full_name || ')'
    FROM public.employees e WHERE e.id = p_pass.employee_id;
$$;

CREATE OR REPLACE FUNCTION public.staff_gate_pass_fmt(p_at timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT to_char(p_at AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI'); $$;

-- Is this staff member's date marked Half day by a pass?
CREATE OR REPLACE FUNCTION public.staff_gate_pass_half_day_exists(p_employee_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_gate_passes g
     WHERE g.employee_id = p_employee_id AND g.pass_date = p_date
       AND ((g.pass_kind = 'half_day' AND g.status = 'out') OR g.status = 'not_returned'));
$$;

-- The staff member's day end: their own duty_end_time, else the global setting.
CREATE OR REPLACE FUNCTION public.staff_gate_pass_day_end(p_employee_id uuid)
RETURNS time LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT e.duty_end_time FROM public.employees e WHERE e.id = p_employee_id),
    (SELECT s.day_end_time FROM public.staff_gate_pass_settings s WHERE s.id),
    '18:00'::time);
$$;

-- Notify the applicant, the approvers and / or the gate pass managers; never the actor.
CREATE OR REPLACE FUNCTION public.staff_gate_pass_notify(
  p_pass public.staff_gate_passes, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_maker boolean DEFAULT true, p_to_approvers boolean DEFAULT true, p_to_gate_managers boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_link text := '/hr/gate-pass/' || p_pass.id::text;
  v_roles text[] := ARRAY['super_admin'];
BEGIN
  IF p_to_approvers THEN v_roles := v_roles || ARRAY['staff_gate_pass_approver']; END IF;
  IF p_to_gate_managers THEN v_roles := v_roles || ARRAY['gate_pass_manager']; END IF;
  IF p_to_approvers OR p_to_gate_managers THEN
    PERFORM public.notify_role(v_roles::app_role[], p_title, p_message, p_type,
      'hr', v_link, 'staff_gate_pass', p_pass.id, v_uid, v_uid);
  END IF;
  IF p_to_maker AND p_pass.created_by IS NOT NULL AND p_pass.created_by IS DISTINCT FROM v_uid
     AND NOT ((p_to_approvers OR p_to_gate_managers) AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = p_pass.created_by AND role::text = ANY (v_roles))) THEN
    PERFORM public.notify_user(p_pass.created_by, p_title, p_message, p_type,
      'hr', v_link, 'staff_gate_pass', p_pass.id, v_uid);
  END IF;
END;
$$;

-- 4. Half day marking --------------------------------------------------------

-- The HR attendance row of the staff member for the pass date becomes a half
-- day (created when missing). check_out is filled with the gate-out time where
-- it was blank and the remark names the pass. Returns the number of attendance
-- rows written (0 or 1).
CREATE OR REPLACE FUNCTION public.staff_gate_pass_mark_half_day(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_out_time time;
  v_remark text;
  v_before text;
  v_n integer := 0;
BEGIN
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_out_time := (COALESCE(g.gate_out_at, now()) AT TIME ZONE 'Asia/Karachi')::time;
  v_remark := 'Left on gate pass ' || g.pass_number;

  SELECT a.status INTO v_before
    FROM public.attendance a
   WHERE a.employee_id = g.employee_id AND a.attendance_date = g.pass_date;

  INSERT INTO public.attendance AS a (employee_id, attendance_date, status, check_out, remarks)
  VALUES (g.employee_id, g.pass_date, 'half_day', v_out_time, v_remark)
  ON CONFLICT (employee_id, attendance_date) DO UPDATE
     SET status = 'half_day',
         check_out = COALESCE(a.check_out, EXCLUDED.check_out),
         remarks = CASE WHEN COALESCE(a.remarks, '') ILIKE '%' || g.pass_number || '%' THEN a.remarks
                        ELSE concat_ws(' · ', NULLIF(btrim(a.remarks), ''), v_remark) END,
         updated_at = now();
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.staff_gate_passes
     SET half_day_marked_at = now(), half_day_rows = v_n, updated_at = now()
   WHERE id = p_id;
  PERFORM public.staff_gate_pass_log(p_id, 'half_day_marked',
    'Marked Half day for ' || to_char(g.pass_date, 'DD Mon YYYY') || ' in HR attendance'
    || CASE WHEN v_before IS NULL THEN ' (attendance row created)'
            WHEN v_before = 'half_day' THEN ''
            ELSE ' (was ' || replace(v_before, '_', ' ') || ')' END,
    jsonb_build_object('rows', v_n, 'previous_status', v_before));
  RETURN v_n;
END;
$$;

-- Any HR attendance row written for a date the staff member left on a half-day
-- pass stays a half day (covers the Attendance page, the Excel import and any
-- other upsert).
CREATE OR REPLACE FUNCTION public.hr_attendance_force_half_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'half_day'
     AND public.staff_gate_pass_half_day_exists(NEW.employee_id, NEW.attendance_date) THEN
    NEW.status := 'half_day';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS hr_attendance_force_half_day ON public.attendance;
CREATE TRIGGER hr_attendance_force_half_day
  BEFORE INSERT OR UPDATE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.hr_attendance_force_half_day();

-- 5. Apply / approve / cancel ------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_gate_pass_apply(
  p_employee_id uuid, p_kind text, p_reason text,
  p_expected_minutes integer DEFAULT NULL, p_leave_time time DEFAULT NULL, p_pass_date date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.employees%ROWTYPE;
  g public.staff_gate_passes%ROWTYPE;
  s public.staff_gate_pass_settings%ROWTYPE;
  v_today date := public.staff_gate_pass_today();
  v_date date := COALESCE(p_pass_date, public.staff_gate_pass_today());
  v_other text;
BEGIN
  IF NOT public.staff_gate_pass_can('apply') THEN
    RAISE EXCEPTION 'Only HR (HR manager / officer) or the staff gate pass approver can apply for a staff gate pass.';
  END IF;
  IF p_kind NOT IN ('half_day','short_leave') THEN
    RAISE EXCEPTION 'Choose Half day or Short leave.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason for the pass.';
  END IF;
  IF v_date < v_today THEN
    RAISE EXCEPTION 'A gate pass cannot be made for a past date.';
  END IF;
  IF v_date > v_today + 7 THEN
    RAISE EXCEPTION 'A gate pass can be made at most 7 days ahead.';
  END IF;
  SELECT * INTO e FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found.';
  END IF;
  IF NOT COALESCE(e.is_active, true) THEN
    RAISE EXCEPTION 'Staff member % is not active.', e.employee_code;
  END IF;
  SELECT * INTO s FROM public.staff_gate_pass_settings WHERE id;

  SELECT pass_number || ' (' || replace(status, '_', ' ') || ')' INTO v_other
    FROM public.staff_gate_passes
   WHERE employee_id = p_employee_id AND pass_date = v_date
     AND status IN ('pending_approval','approved','out')
   LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Staff member % already has gate pass % for %.', e.employee_code, v_other, to_char(v_date, 'DD Mon');
  END IF;

  INSERT INTO public.staff_gate_passes
    (pass_kind, pass_date, employee_id, department_id, reason, expected_minutes, leave_time, created_by)
  VALUES
    (p_kind, v_date, p_employee_id, e.department_id, btrim(p_reason),
     CASE WHEN p_kind = 'short_leave' THEN COALESCE(p_expected_minutes, s.default_expected_minutes) END,
     p_leave_time, public.app_user_id())
  RETURNING * INTO g;

  PERFORM public.staff_gate_pass_log(g.id, 'applied',
    CASE WHEN p_kind = 'half_day' THEN 'Half day' ELSE 'Short leave, ' || g.expected_minutes || ' min' END
    || ': ' || btrim(p_reason));
  PERFORM public.staff_gate_pass_notify(g, 'Staff gate pass needs approval',
    public.staff_gate_pass_label(g) || ' — ' || CASE WHEN p_kind = 'half_day' THEN 'half day' ELSE 'short leave, ' || g.expected_minutes || ' min' END
      || ' on ' || to_char(v_date, 'DD Mon') || ': ' || btrim(p_reason),
    'info', false, true);
  RETURN g.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_gate_pass_review(p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF NOT public.staff_gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only the staff gate pass approver can approve or reject staff passes.';
  END IF;
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Gate pass % is not waiting for approval.', g.pass_number;
  END IF;
  IF NOT p_approve AND NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the pass.';
  END IF;
  IF p_approve AND g.pass_date < public.staff_gate_pass_today() THEN
    RAISE EXCEPTION 'Gate pass % was for %, which has passed.', g.pass_number, to_char(g.pass_date, 'DD Mon');
  END IF;

  UPDATE public.staff_gate_passes
     SET status = v_status, approved_by = public.app_user_id(), approved_at = now(),
         approval_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, v_status, NULLIF(btrim(p_remarks), ''));
  PERFORM public.staff_gate_pass_notify(g, 'Staff gate pass ' || v_status,
    public.staff_gate_pass_label(g) || ' for ' || to_char(g.pass_date, 'DD Mon') || COALESCE(': ' || NULLIF(btrim(p_remarks), ''), ''),
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END, true, false);
  RETURN v_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_gate_pass_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status NOT IN ('pending_approval','approved') THEN
    RAISE EXCEPTION 'Gate pass % is % and cannot be cancelled.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF NOT (public.staff_gate_pass_can('approve')
          OR (public.staff_gate_pass_can('apply') AND g.created_by = v_uid)) THEN
    RAISE EXCEPTION 'Only the approver or the person who applied can cancel this pass.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the pass.';
  END IF;

  UPDATE public.staff_gate_passes
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(),
         cancel_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'cancelled', btrim(p_reason));
  PERFORM public.staff_gate_pass_notify(g, 'Staff gate pass cancelled',
    public.staff_gate_pass_label(g) || ': ' || btrim(p_reason), 'warning', true, true);
END;
$$;

-- 6. At the gate --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_gate_pass_gate_out(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  s public.staff_gate_pass_settings%ROWTYPE;
  v_uid uuid := public.app_user_id();
  v_rows integer := 0;
BEGIN
  IF NOT public.staff_gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can use Gate Check.';
  END IF;
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  -- The same guard tapping twice within 10 seconds gets the same answer, not an error.
  IF g.status = 'out' AND g.gate_out_by IS NOT DISTINCT FROM v_uid AND g.gate_out_at > now() - interval '10 seconds' THEN
    RETURN jsonb_build_object('status', 'out', 'repeat', true, 'pass_kind', g.pass_kind,
      'gate_out_at', g.gate_out_at, 'expected_back_at', g.expected_back_at, 'half_day_rows', g.half_day_rows);
  END IF;
  IF g.status <> 'approved' THEN
    RAISE EXCEPTION 'Gate pass % is % — the staff member cannot go out on it.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF g.pass_date <> public.staff_gate_pass_today() THEN
    RAISE EXCEPTION 'Gate pass % is for %, not today.', g.pass_number, to_char(g.pass_date, 'DD Mon');
  END IF;
  SELECT * INTO s FROM public.staff_gate_pass_settings WHERE id;

  UPDATE public.staff_gate_passes
     SET status = 'out', gate_out_by = v_uid, gate_out_at = now(),
         expected_back_at = CASE WHEN pass_kind = 'short_leave'
                                 THEN now() + make_interval(mins => COALESCE(expected_minutes, s.default_expected_minutes)) END,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'out',
    CASE WHEN g.pass_kind = 'half_day' THEN 'Out at gate — half day'
         ELSE 'Out at gate — due back ' || public.staff_gate_pass_fmt(g.expected_back_at) END);

  IF g.pass_kind = 'half_day' THEN
    v_rows := public.staff_gate_pass_mark_half_day(p_id);
  END IF;

  PERFORM public.staff_gate_pass_notify(g,
    CASE WHEN g.pass_kind = 'half_day' THEN 'Staff member out — half day marked' ELSE 'Staff member out on short leave' END,
    public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
      || CASE WHEN g.pass_kind = 'half_day' THEN '. ' || to_char(g.pass_date, 'DD Mon') || ' is marked Half day in HR attendance.'
              ELSE '. Due back ' || public.staff_gate_pass_fmt(g.expected_back_at) || '.' END,
    'info', true, false);

  RETURN jsonb_build_object('status', 'out', 'repeat', false, 'pass_kind', g.pass_kind,
    'gate_out_at', g.gate_out_at, 'expected_back_at', g.expected_back_at, 'half_day_rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.staff_gate_pass_gate_in(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_uid uuid := public.app_user_id();
  v_minutes integer;
  v_late integer;
BEGIN
  IF NOT public.staff_gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can use Gate Check.';
  END IF;
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status = 'returned' AND g.gate_in_by IS NOT DISTINCT FROM v_uid AND g.gate_in_at > now() - interval '10 seconds' THEN
    RETURN jsonb_build_object('status', 'returned', 'repeat', true, 'gate_in_at', g.gate_in_at,
      'minutes_outside', g.minutes_outside, 'late_minutes', GREATEST(0, EXTRACT(EPOCH FROM (g.gate_in_at - g.expected_back_at)) / 60)::integer);
  END IF;
  IF g.pass_kind <> 'short_leave' THEN
    RAISE EXCEPTION 'Gate pass % is a half-day pass — the staff member is not expected back today.', g.pass_number;
  END IF;
  IF g.status <> 'out' THEN
    RAISE EXCEPTION 'Gate pass % is % — there is nothing to scan in.', g.pass_number, replace(g.status, '_', ' ');
  END IF;

  v_minutes := CEIL(EXTRACT(EPOCH FROM (now() - g.gate_out_at)) / 60)::integer;
  v_late := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - g.expected_back_at)) / 60))::integer;
  UPDATE public.staff_gate_passes
     SET status = 'returned', gate_in_by = v_uid, gate_in_at = now(), minutes_outside = v_minutes, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'in',
    'Back at gate after ' || v_minutes || ' min' || CASE WHEN v_late > 0 THEN ' (' || v_late || ' min late)' ELSE '' END,
    jsonb_build_object('minutes_outside', v_minutes, 'late_minutes', v_late));
  PERFORM public.staff_gate_pass_notify(g, 'Staff member back from short leave',
    public.staff_gate_pass_label(g) || ' came back at ' || public.staff_gate_pass_fmt(g.gate_in_at)
      || ' after ' || v_minutes || ' min' || CASE WHEN v_late > 0 THEN ' (' || v_late || ' min late)' ELSE '' END || '.',
    CASE WHEN v_late > 0 THEN 'warning' ELSE 'info' END, true, v_late > 0);

  RETURN jsonb_build_object('status', 'returned', 'repeat', false, 'gate_in_at', g.gate_in_at,
    'minutes_outside', v_minutes, 'late_minutes', v_late);
END;
$$;

-- A pass that cannot be used (already used, returned, closed, cancelled,
-- rejected, expired, or not for today) was opened on Gate Check: log the
-- attempt every time and tell the approvers, the applicant and the gate pass
-- managers, at most once per pass every 10 minutes.
CREATE OR REPLACE FUNCTION public.staff_gate_pass_log_rescan(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_invalid boolean;
  v_recent boolean;
  v_msg text;
  v_n integer;
BEGIN
  IF NOT public.staff_gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can use Gate Check.';
  END IF;
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  v_invalid := g.status IN ('returned','not_returned','expired','rejected','cancelled')
            OR (g.status = 'out' AND g.pass_kind = 'half_day')
            OR (g.status IN ('approved','out') AND g.pass_date <> public.staff_gate_pass_today());
  IF NOT v_invalid THEN
    RETURN jsonb_build_object('logged', false);
  END IF;

  v_msg := 'Scanned again at the gate — pass is ' || replace(g.status, '_', ' ')
        || CASE WHEN g.status IN ('approved','out') AND g.pass_date <> public.staff_gate_pass_today()
                THEN ' for ' || to_char(g.pass_date, 'DD Mon') || ', not today' ELSE '' END
        || CASE WHEN g.gate_out_at IS NOT NULL THEN ', went out ' || public.staff_gate_pass_fmt(g.gate_out_at) ELSE '' END
        || CASE WHEN g.gate_in_at IS NOT NULL THEN ', came back ' || public.staff_gate_pass_fmt(g.gate_in_at) ELSE '' END;

  SELECT EXISTS (SELECT 1 FROM public.staff_gate_pass_events
                  WHERE pass_id = p_id AND event = 'rescan_attempt'
                    AND created_at > now() - interval '10 minutes') INTO v_recent;

  PERFORM public.staff_gate_pass_log(p_id, 'rescan_attempt', v_msg, jsonb_build_object('status', g.status));
  SELECT count(*) INTO v_n FROM public.staff_gate_pass_events WHERE pass_id = p_id AND event = 'rescan_attempt';

  IF NOT v_recent THEN
    PERFORM public.staff_gate_pass_notify(g, 'Old staff gate pass scanned again',
      public.staff_gate_pass_label(g) || ' was scanned again at the gate. ' || v_msg,
      'error', true, true, true);
  END IF;
  RETURN jsonb_build_object('logged', true, 'attempts', v_n, 'notified', NOT v_recent);
END;
$$;

-- 7. Approver: convert an overdue short leave to a half day -------------------

CREATE OR REPLACE FUNCTION public.staff_gate_pass_convert_half_day(p_id uuid, p_reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_rows integer;
BEGIN
  IF NOT public.staff_gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only the staff gate pass approver can convert a pass to a half day.';
  END IF;
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF NOT (g.pass_kind = 'short_leave' AND g.status = 'out') THEN
    RAISE EXCEPTION 'Only a short leave that is still out can be converted to a half day.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason.';
  END IF;

  UPDATE public.staff_gate_passes
     SET status = 'not_returned', closed_at = now(), close_note = btrim(p_reason), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'not_returned', 'Converted to half day by the approver: ' || btrim(p_reason));
  v_rows := public.staff_gate_pass_mark_half_day(p_id);
  PERFORM public.staff_gate_pass_notify(g, 'Short leave converted to half day',
    public.staff_gate_pass_label(g) || ' did not come back; ' || to_char(g.pass_date, 'DD Mon') || ' is marked Half day. ' || btrim(p_reason),
    'warning', true, false);
  RETURN v_rows;
END;
$$;

-- 8. Scheduled: overdue notices and day close --------------------------------

-- Runs every 5 minutes (pg_cron). No role check: pg_cron has no app user, and
-- the function is not granted to app roles. Day end is each staff member's own
-- duty_end_time (else the global setting).
CREATE OR REPLACE FUNCTION public.staff_gate_pass_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.staff_gate_pass_settings%ROWTYPE;
  g public.staff_gate_passes%ROWTYPE;
  v_today date := public.staff_gate_pass_today();
  v_time time := (now() AT TIME ZONE 'Asia/Karachi')::time;
  v_overdue integer := 0;
  v_expired integer := 0;
  v_not_returned integer := 0;
  v_late integer;
BEGIN
  SELECT * INTO s FROM public.staff_gate_pass_settings WHERE id;

  -- Short leaves past their expected return plus the grace period: tell the
  -- applicant and the approvers once.
  FOR g IN
    SELECT * FROM public.staff_gate_passes
     WHERE status = 'out' AND pass_kind = 'short_leave' AND overdue_notified_at IS NULL
       AND expected_back_at + make_interval(mins => s.grace_minutes) < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    v_late := CEIL(EXTRACT(EPOCH FROM (now() - g.expected_back_at)) / 60)::integer;
    UPDATE public.staff_gate_passes SET overdue_notified_at = now(), updated_at = now() WHERE id = g.id;
    PERFORM public.staff_gate_pass_log(g.id, 'overdue', 'Not back ' || v_late || ' min after the expected return');
    PERFORM public.staff_gate_pass_notify(g, 'Staff member late back from short leave',
      public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
        || ' and is ' || v_late || ' min past the expected return.', 'warning', true, true);
    v_overdue := v_overdue + 1;
  END LOOP;

  -- Day close: passes for a past date, or for today after the staff member's day end.
  FOR g IN
    SELECT p.* FROM public.staff_gate_passes p
     WHERE p.status IN ('pending_approval','approved','out')
       AND (p.pass_date < v_today
            OR (p.pass_date = v_today AND v_time >= public.staff_gate_pass_day_end(p.employee_id)))
       AND NOT (p.status = 'out' AND p.pass_kind = 'half_day')
     ORDER BY p.pass_date
     FOR UPDATE SKIP LOCKED
  LOOP
    IF g.status IN ('pending_approval','approved') THEN
      UPDATE public.staff_gate_passes
         SET status = 'expired', closed_at = now(),
             close_note = CASE WHEN g.status = 'approved' THEN 'Not used by day end' ELSE 'Not approved by day end' END,
             updated_at = now()
       WHERE id = g.id RETURNING * INTO g;
      PERFORM public.staff_gate_pass_log(g.id, 'expired', g.close_note);
      PERFORM public.staff_gate_pass_notify(g, 'Staff gate pass expired',
        public.staff_gate_pass_label(g) || ' for ' || to_char(g.pass_date, 'DD Mon') || ': ' || g.close_note || '.',
        'info', true, g.close_note = 'Not approved by day end');
      v_expired := v_expired + 1;
    ELSE
      UPDATE public.staff_gate_passes
         SET status = 'not_returned', closed_at = now(), close_note = 'Still out at day end', updated_at = now()
       WHERE id = g.id RETURNING * INTO g;
      PERFORM public.staff_gate_pass_log(g.id, 'not_returned', 'Still out at day end'
        || CASE WHEN s.auto_half_day_not_returned THEN ' — marked half day' ELSE '' END);
      IF s.auto_half_day_not_returned THEN
        PERFORM public.staff_gate_pass_mark_half_day(g.id);
      END IF;
      PERFORM public.staff_gate_pass_notify(g, 'Staff member did not come back from short leave',
        public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
          || ' and was not scanned back in by day end.'
          || CASE WHEN s.auto_half_day_not_returned THEN ' ' || to_char(g.pass_date, 'DD Mon') || ' is marked Half day.' ELSE '' END,
        'warning', true, true);
      v_not_returned := v_not_returned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('overdue', v_overdue, 'expired', v_expired, 'not_returned', v_not_returned);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'staff-gate-pass-tick';
    PERFORM cron.schedule('staff-gate-pass-tick', '*/5 * * * *', 'SELECT public.staff_gate_pass_tick()');
  END IF;
END $$;

-- 9. Settings ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_gate_pass_settings_save(
  p_default_expected_minutes integer, p_grace_minutes integer, p_day_end_time time, p_auto_half_day boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the staff gate pass settings.';
  END IF;
  UPDATE public.staff_gate_pass_settings
     SET default_expected_minutes = COALESCE(p_default_expected_minutes, default_expected_minutes),
         grace_minutes = COALESCE(p_grace_minutes, grace_minutes),
         day_end_time = COALESCE(p_day_end_time, day_end_time),
         auto_half_day_not_returned = COALESCE(p_auto_half_day, auto_half_day_not_returned),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 10. Grants --------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.staff_gate_pass_can(text),
  public.staff_gate_pass_today(),
  public.staff_gate_pass_half_day_exists(uuid, date),
  public.staff_gate_pass_day_end(uuid),
  public.staff_gate_pass_apply(uuid, text, text, integer, time, date),
  public.staff_gate_pass_review(uuid, boolean, text),
  public.staff_gate_pass_cancel(uuid, text),
  public.staff_gate_pass_gate_out(uuid),
  public.staff_gate_pass_gate_in(uuid),
  public.staff_gate_pass_log_rescan(uuid),
  public.staff_gate_pass_convert_half_day(uuid, text),
  public.staff_gate_pass_settings_save(integer, integer, time, boolean)
  TO anon, authenticated, service_role;

-- Internal helpers and the scheduled tick: service role only.
REVOKE ALL ON FUNCTION
  public.staff_gate_pass_log(uuid, text, text, jsonb),
  public.staff_gate_pass_label(public.staff_gate_passes),
  public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean),
  public.staff_gate_pass_mark_half_day(uuid),
  public.staff_gate_pass_tick()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.staff_gate_pass_log(uuid, text, text, jsonb),
  public.staff_gate_pass_label(public.staff_gate_passes),
  public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean),
  public.staff_gate_pass_mark_half_day(uuid),
  public.staff_gate_pass_tick()
  TO service_role;
