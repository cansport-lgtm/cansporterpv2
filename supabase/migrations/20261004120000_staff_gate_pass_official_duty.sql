-- ============================================================================
-- Staff Gate Pass: Official duty (company work — purchases, bank, site visits)
-- ----------------------------------------------------------------------------
-- A third pass kind for staff, next to half_day and short_leave:
--
--   official_duty  The staff member goes out on company work and comes back.
--                  Scanned Out and In like a short leave, but attendance is
--                  never touched: no half day on Out, and no half day when the
--                  person is still out at day end (the pass closes as "not
--                  scanned in" and HR is informed, nobody is alarmed). A
--                  destination is recorded with the reason. Late-back notices
--                  are information for HR, not warnings. Default expected time
--                  is its own setting (180 min).
--
-- Who raises it:
--   • HR (hr_manager / hr_officer) and the approver, as for the other kinds.
--   • The staff member themselves, when their login is linked to their staff
--     record (employees.app_user_id). Self-apply is for official duty only.
--
-- Approval:
--   • employees.field_duty_allowed = true → the pass is approved the moment it
--     is raised (purchase officers, drivers, …). Logged as auto-approved.
--   • otherwise the staff gate pass approver approves as usual.
--
-- Builds on 20261003120100_staff_gate_pass.sql.
-- Rollback: supabase/rollbacks/20261004120000_staff_gate_pass_official_duty_down.sql
-- ============================================================================

-- 1. Schema ------------------------------------------------------------------

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS field_duty_allowed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.employees.field_duty_allowed IS
  'Official duty gate passes for this staff member are approved automatically (field staff: purchases, bank, site visits).';

ALTER TABLE public.staff_gate_passes DROP CONSTRAINT IF EXISTS staff_gate_passes_pass_kind_check;
ALTER TABLE public.staff_gate_passes
  ADD CONSTRAINT staff_gate_passes_pass_kind_check CHECK (pass_kind IN ('half_day','short_leave','official_duty'));
ALTER TABLE public.staff_gate_passes ADD COLUMN IF NOT EXISTS destination text;

ALTER TABLE public.staff_gate_pass_settings
  ADD COLUMN IF NOT EXISTS official_default_expected_minutes integer NOT NULL DEFAULT 180
    CHECK (official_default_expected_minutes BETWEEN 5 AND 720);

-- A not-returned official duty pass is NOT a half day: exclude it everywhere
-- the half-day marks are read.
DROP INDEX IF EXISTS public.staff_gate_passes_half_day_idx;
CREATE INDEX IF NOT EXISTS staff_gate_passes_half_day_idx
  ON public.staff_gate_passes (employee_id, pass_date)
  WHERE (pass_kind = 'half_day' AND status = 'out') OR (pass_kind <> 'official_duty' AND status = 'not_returned');

CREATE OR REPLACE VIEW public.v_staff_gate_pass_half_days AS
SELECT g.employee_id, g.pass_date, g.id AS pass_id, g.pass_number, g.pass_kind, g.status,
       g.gate_out_at, g.half_day_marked_at
  FROM public.staff_gate_passes g
 WHERE (g.pass_kind = 'half_day' AND g.status = 'out') OR (g.pass_kind <> 'official_duty' AND g.status = 'not_returned');

GRANT SELECT ON public.v_staff_gate_pass_half_days TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.staff_gate_pass_half_day_exists(p_employee_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff_gate_passes g
     WHERE g.employee_id = p_employee_id AND g.pass_date = p_date
       AND ((g.pass_kind = 'half_day' AND g.status = 'out') OR (g.pass_kind <> 'official_duty' AND g.status = 'not_returned')));
$$;

-- 2. Helpers -----------------------------------------------------------------

-- Is the current login the staff member on this pass (self-service)?
CREATE OR REPLACE FUNCTION public.staff_gate_pass_is_self(p_employee_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.employees e
     WHERE e.id = p_employee_id AND e.app_user_id IS NOT NULL AND e.app_user_id = public.app_user_id());
$$;

-- Notify the applicant, the approvers, the gate pass managers and / or the HR
-- managers; never the actor. A staff member who raised their own pass gets the
-- self-service link, which their login can open without any HR role.
DROP FUNCTION IF EXISTS public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean);
CREATE OR REPLACE FUNCTION public.staff_gate_pass_notify(
  p_pass public.staff_gate_passes, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_maker boolean DEFAULT true, p_to_approvers boolean DEFAULT true, p_to_gate_managers boolean DEFAULT false,
  p_to_hr boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_link text := '/hr/gate-pass/' || p_pass.id::text;
  v_maker_link text;
  v_roles text[] := ARRAY['super_admin'];
BEGIN
  IF p_to_approvers THEN v_roles := v_roles || ARRAY['staff_gate_pass_approver']; END IF;
  IF p_to_gate_managers THEN v_roles := v_roles || ARRAY['gate_pass_manager']; END IF;
  IF p_to_hr THEN v_roles := v_roles || ARRAY['hr_manager']; END IF;
  IF p_to_approvers OR p_to_gate_managers OR p_to_hr THEN
    PERFORM public.notify_role(v_roles::app_role[], p_title, p_message, p_type,
      'hr', v_link, 'staff_gate_pass', p_pass.id, v_uid, v_uid);
  END IF;
  IF p_to_maker AND p_pass.created_by IS NOT NULL AND p_pass.created_by IS DISTINCT FROM v_uid
     AND NOT ((p_to_approvers OR p_to_gate_managers OR p_to_hr) AND EXISTS (
       SELECT 1 FROM public.user_roles
        WHERE user_id = p_pass.created_by AND role::text = ANY (v_roles))) THEN
    v_maker_link := CASE WHEN EXISTS (SELECT 1 FROM public.employees e
                                       WHERE e.id = p_pass.employee_id AND e.app_user_id = p_pass.created_by)
                         THEN '/my-gate-pass/' || p_pass.id::text ELSE v_link END;
    PERFORM public.notify_user(p_pass.created_by, p_title, p_message, p_type,
      'hr', v_maker_link, 'staff_gate_pass', p_pass.id, v_uid);
  END IF;
END;
$$;

-- "half day" / "short leave, 30 min" / "company work, 180 min (Bank)"
CREATE OR REPLACE FUNCTION public.staff_gate_pass_kind_text(p_pass public.staff_gate_passes)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_pass.pass_kind
    WHEN 'half_day' THEN 'half day'
    WHEN 'short_leave' THEN 'short leave, ' || p_pass.expected_minutes || ' min'
    ELSE 'company work, ' || p_pass.expected_minutes || ' min' || COALESCE(' (' || NULLIF(btrim(p_pass.destination), '') || ')', '')
  END;
$$;

-- 3. Half day marking never applies to official duty ----------------------------

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
  IF NOT FOUND OR g.pass_kind = 'official_duty' THEN RETURN 0; END IF;
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

-- 4. Apply (HR, approver, or the staff member for official duty) ----------------

DROP FUNCTION IF EXISTS public.staff_gate_pass_apply(uuid, text, text, integer, time, date);
CREATE OR REPLACE FUNCTION public.staff_gate_pass_apply(
  p_employee_id uuid, p_kind text, p_reason text,
  p_expected_minutes integer DEFAULT NULL, p_leave_time time DEFAULT NULL, p_pass_date date DEFAULT NULL,
  p_destination text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.employees%ROWTYPE;
  g public.staff_gate_passes%ROWTYPE;
  s public.staff_gate_pass_settings%ROWTYPE;
  v_today date := public.staff_gate_pass_today();
  v_date date := COALESCE(p_pass_date, public.staff_gate_pass_today());
  v_other text;
  v_self boolean;
  v_auto boolean;
BEGIN
  IF p_kind NOT IN ('half_day','short_leave','official_duty') THEN
    RAISE EXCEPTION 'Choose Half day, Short leave or Official duty.';
  END IF;
  SELECT * INTO e FROM public.employees WHERE id = p_employee_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found.';
  END IF;
  v_self := e.app_user_id IS NOT NULL AND e.app_user_id = public.app_user_id();
  IF NOT (public.staff_gate_pass_can('apply') OR (v_self AND p_kind = 'official_duty')) THEN
    IF v_self THEN
      RAISE EXCEPTION 'You can raise an Official duty pass for yourself; half days and short leaves are raised by HR.';
    END IF;
    RAISE EXCEPTION 'Only HR (HR manager / officer) or the staff gate pass approver can apply for a staff gate pass.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason for the pass.';
  END IF;
  IF p_kind = 'official_duty' AND NULLIF(btrim(p_destination), '') IS NULL THEN
    RAISE EXCEPTION 'Give the destination (where the company work is).';
  END IF;
  IF v_date < v_today THEN
    RAISE EXCEPTION 'A gate pass cannot be made for a past date.';
  END IF;
  IF v_date > v_today + 7 THEN
    RAISE EXCEPTION 'A gate pass can be made at most 7 days ahead.';
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

  v_auto := p_kind = 'official_duty' AND COALESCE(e.field_duty_allowed, false);

  INSERT INTO public.staff_gate_passes
    (pass_kind, pass_date, employee_id, department_id, reason, destination, expected_minutes, leave_time, created_by,
     status, approved_at, approval_remarks)
  VALUES
    (p_kind, v_date, p_employee_id, e.department_id, btrim(p_reason), NULLIF(btrim(p_destination), ''),
     CASE WHEN p_kind = 'short_leave' THEN COALESCE(p_expected_minutes, s.default_expected_minutes)
          WHEN p_kind = 'official_duty' THEN COALESCE(p_expected_minutes, s.official_default_expected_minutes) END,
     p_leave_time, public.app_user_id(),
     CASE WHEN v_auto THEN 'approved' ELSE 'pending_approval' END,
     CASE WHEN v_auto THEN now() END,
     CASE WHEN v_auto THEN 'Auto-approved: field duty allowed' END)
  RETURNING * INTO g;

  PERFORM public.staff_gate_pass_log(g.id, 'applied',
    initcap(substr(public.staff_gate_pass_kind_text(g), 1, 1)) || substr(public.staff_gate_pass_kind_text(g), 2)
    || ': ' || btrim(p_reason) || CASE WHEN v_self THEN ' (raised by the staff member)' ELSE '' END);

  IF v_auto THEN
    PERFORM public.staff_gate_pass_log(g.id, 'approved', 'Auto-approved — field duty allowed for this staff member');
  ELSE
    PERFORM public.staff_gate_pass_notify(g, 'Staff gate pass needs approval',
      public.staff_gate_pass_label(g) || ' — ' || public.staff_gate_pass_kind_text(g)
        || ' on ' || to_char(v_date, 'DD Mon') || ': ' || btrim(p_reason),
      'info', false, true);
  END IF;
  RETURN g.id;
END;
$$;

-- 5. Cancel: the person who raised the pass may always cancel it before Out ----

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
  IF NOT (public.staff_gate_pass_can('approve') OR g.created_by = v_uid) THEN
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
    public.staff_gate_pass_label(g) || ': ' || btrim(p_reason), 'warning', true,
    -- an auto-approved official duty pass never reached the approver: don't bother them now
    NOT (g.approved_at IS NOT NULL AND g.approved_by IS NULL));
END;
$$;

-- 6. At the gate ----------------------------------------------------------------

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
                                 THEN now() + make_interval(mins => COALESCE(expected_minutes, s.default_expected_minutes))
                                 WHEN pass_kind = 'official_duty'
                                 THEN now() + make_interval(mins => COALESCE(expected_minutes, s.official_default_expected_minutes)) END,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'out',
    CASE WHEN g.pass_kind = 'half_day' THEN 'Out at gate — half day'
         WHEN g.pass_kind = 'official_duty' THEN 'Out at gate — company work' || COALESCE(' at ' || g.destination, '') || ' — due back ' || public.staff_gate_pass_fmt(g.expected_back_at)
         ELSE 'Out at gate — due back ' || public.staff_gate_pass_fmt(g.expected_back_at) END);

  IF g.pass_kind = 'half_day' THEN
    v_rows := public.staff_gate_pass_mark_half_day(p_id);
  END IF;

  PERFORM public.staff_gate_pass_notify(g,
    CASE WHEN g.pass_kind = 'half_day' THEN 'Staff member out — half day marked'
         WHEN g.pass_kind = 'official_duty' THEN 'Staff member out on company work'
         ELSE 'Staff member out on short leave' END,
    public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
      || CASE WHEN g.pass_kind = 'half_day' THEN '. ' || to_char(g.pass_date, 'DD Mon') || ' is marked Half day in HR attendance.'
              WHEN g.pass_kind = 'official_duty' THEN COALESCE(' for ' || g.destination, '') || '. Due back ' || public.staff_gate_pass_fmt(g.expected_back_at) || '.'
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
  v_official boolean;
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
  IF g.pass_kind = 'half_day' THEN
    RAISE EXCEPTION 'Gate pass % is a half-day pass — the staff member is not expected back today.', g.pass_number;
  END IF;
  IF g.status <> 'out' THEN
    RAISE EXCEPTION 'Gate pass % is % — there is nothing to scan in.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  v_official := g.pass_kind = 'official_duty';

  v_minutes := CEIL(EXTRACT(EPOCH FROM (now() - g.gate_out_at)) / 60)::integer;
  v_late := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - g.expected_back_at)) / 60))::integer;
  UPDATE public.staff_gate_passes
     SET status = 'returned', gate_in_by = v_uid, gate_in_at = now(), minutes_outside = v_minutes, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'in',
    'Back at gate after ' || v_minutes || ' min' || CASE WHEN v_late > 0 THEN ' (' || v_late || ' min late)' ELSE '' END,
    jsonb_build_object('minutes_outside', v_minutes, 'late_minutes', v_late));
  IF v_official THEN
    PERFORM public.staff_gate_pass_notify(g, 'Staff member back from company work',
      public.staff_gate_pass_label(g) || ' came back at ' || public.staff_gate_pass_fmt(g.gate_in_at)
        || ' after ' || v_minutes || ' min' || COALESCE(' (' || g.destination || ')', '') || '.',
      'info', true, false, false, v_late > 0);
  ELSE
    PERFORM public.staff_gate_pass_notify(g, 'Staff member back from short leave',
      public.staff_gate_pass_label(g) || ' came back at ' || public.staff_gate_pass_fmt(g.gate_in_at)
        || ' after ' || v_minutes || ' min' || CASE WHEN v_late > 0 THEN ' (' || v_late || ' min late)' ELSE '' END || '.',
      CASE WHEN v_late > 0 THEN 'warning' ELSE 'info' END, true, v_late > 0);
  END IF;

  RETURN jsonb_build_object('status', 'returned', 'repeat', false, 'gate_in_at', g.gate_in_at,
    'minutes_outside', v_minutes, 'late_minutes', v_late);
END;
$$;

-- 7. Scheduled: official duty is informed to HR, never alarmed, never a half day --

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

  FOR g IN
    SELECT * FROM public.staff_gate_passes
     WHERE status = 'out' AND pass_kind IN ('short_leave','official_duty') AND overdue_notified_at IS NULL
       AND expected_back_at + make_interval(mins => s.grace_minutes) < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    v_late := CEIL(EXTRACT(EPOCH FROM (now() - g.expected_back_at)) / 60)::integer;
    UPDATE public.staff_gate_passes SET overdue_notified_at = now(), updated_at = now() WHERE id = g.id;
    PERFORM public.staff_gate_pass_log(g.id, 'overdue', 'Not back ' || v_late || ' min after the expected return');
    IF g.pass_kind = 'official_duty' THEN
      PERFORM public.staff_gate_pass_notify(g, 'Staff member still out on company work',
        public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
          || COALESCE(' for ' || g.destination, '') || ' and is ' || v_late || ' min past the expected return.',
        'info', true, false, false, true);
    ELSE
      PERFORM public.staff_gate_pass_notify(g, 'Staff member late back from short leave',
        public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
          || ' and is ' || v_late || ' min past the expected return.', 'warning', true, true);
    END IF;
    v_overdue := v_overdue + 1;
  END LOOP;

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
    ELSIF g.pass_kind = 'official_duty' THEN
      UPDATE public.staff_gate_passes
         SET status = 'not_returned', closed_at = now(), close_note = 'Not scanned in by day end — company work', updated_at = now()
       WHERE id = g.id RETURNING * INTO g;
      PERFORM public.staff_gate_pass_log(g.id, 'not_returned', 'Not scanned in by day end — company work, attendance not affected');
      PERFORM public.staff_gate_pass_notify(g, 'Staff member not scanned back in from company work',
        public.staff_gate_pass_label(g) || ' went out at ' || public.staff_gate_pass_fmt(g.gate_out_at)
          || COALESCE(' for ' || g.destination, '') || ' and was not scanned back in by day end. Attendance is not affected.',
        'info', true, false, false, true);
      v_not_returned := v_not_returned + 1;
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

-- 8. Settings ------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.staff_gate_pass_settings_save(integer, integer, time, boolean);
CREATE OR REPLACE FUNCTION public.staff_gate_pass_settings_save(
  p_default_expected_minutes integer, p_grace_minutes integer, p_day_end_time time, p_auto_half_day boolean,
  p_official_default_expected_minutes integer DEFAULT NULL
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
         official_default_expected_minutes = COALESCE(p_official_default_expected_minutes, official_default_expected_minutes),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 9. Grants ----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.staff_gate_pass_is_self(uuid),
  public.staff_gate_pass_apply(uuid, text, text, integer, time, date, text),
  public.staff_gate_pass_settings_save(integer, integer, time, boolean, integer)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean, boolean),
  public.staff_gate_pass_kind_text(public.staff_gate_passes)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean, boolean),
  public.staff_gate_pass_kind_text(public.staff_gate_passes)
  TO service_role;
