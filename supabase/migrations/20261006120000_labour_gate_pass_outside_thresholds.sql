-- ============================================================================
-- Labour Gate Pass: time-outside thresholds for short leave
-- ----------------------------------------------------------------------------
-- A worker on a SHORT LEAVE who stays outside too long loses attendance:
--
--   over 3 hours outside  → the date is a HALF DAY  (half_day_after_minutes, 180)
--   over 6 hours outside  → the date is ABSENT       (absent_after_minutes, 360)
--
-- Time outside counts only inside the official working hours, 08:30 to 19:30
-- (day_start_time / day_end_time in the settings), from the gate-out scan to
-- the gate-in scan or to day end. The effect is applied the moment the
-- threshold is crossed, by the five-minute tick, or at the gate-in scan,
-- whichever comes first; scanning in afterwards records the return but never
-- undoes it. A short leave still out at day end closes as "not returned" with
-- whatever effect its time outside earned — under 3 hours means no effect
-- (the old automatic half day on "not returned" no longer applies).
--
-- Effects live in labour_gate_passes.attendance_effect:
--   half_day  every productivity row of the worker for that date becomes a
--             half day, and later rows stay half day (as before);
--   absent    the worker's productivity rows for that date are DELETED (kept
--             as a snapshot in the pass history) and no row can be added for
--             that worker and date afterwards. The sheets show A, the salary
--             pays nothing for the day.
--
-- Half-day passes keep marking a half day on Out. Official duty is never
-- affected. Written without DROP INDEX / DROP FUNCTION (hosted runner).
-- Builds on 20261005120000_labour_gate_pass_official_duty.sql.
-- Rollback: supabase/rollbacks/20261006120000_labour_gate_pass_outside_thresholds_down.sql
-- ============================================================================

-- 1. Schema ------------------------------------------------------------------

ALTER TABLE public.labour_gate_pass_settings
  ADD COLUMN IF NOT EXISTS day_start_time time NOT NULL DEFAULT '08:30',
  ADD COLUMN IF NOT EXISTS half_day_after_minutes integer NOT NULL DEFAULT 180
    CHECK (half_day_after_minutes BETWEEN 30 AND 720),
  ADD COLUMN IF NOT EXISTS absent_after_minutes integer NOT NULL DEFAULT 360
    CHECK (absent_after_minutes BETWEEN 60 AND 720);
-- Official timing 08:30 – 19:30.
UPDATE public.labour_gate_pass_settings SET day_start_time = '08:30', day_end_time = '19:30', updated_at = now();

ALTER TABLE public.labour_gate_passes
  ADD COLUMN IF NOT EXISTS attendance_effect text CHECK (attendance_effect IN ('half_day','absent')),
  ADD COLUMN IF NOT EXISTS attendance_marked_at timestamptz,
  -- minutes outside inside the official hours (final at gate-in or day end)
  ADD COLUMN IF NOT EXISTS work_minutes_outside integer;

-- Passes that already marked a half day under the old rule keep it.
UPDATE public.labour_gate_passes
   SET attendance_effect = 'half_day', attendance_marked_at = COALESCE(half_day_marked_at, closed_at, gate_out_at)
 WHERE attendance_effect IS NULL
   AND ((pass_kind = 'half_day' AND status = 'out') OR (pass_kind <> 'official_duty' AND status = 'not_returned'));

CREATE INDEX IF NOT EXISTS labour_gate_passes_effect_idx
  ON public.labour_gate_passes (employee_id, pass_date) WHERE attendance_effect IS NOT NULL;

-- 2. Views and predicates ---------------------------------------------------------

-- Dates with an attendance effect from a gate pass (half day or absent). The
-- column `effect` is new; existing readers that treat every row as a half day
-- are updated in the same release.
CREATE OR REPLACE VIEW public.v_labour_gate_pass_half_days AS
SELECT g.employee_id, g.pass_date, g.id AS pass_id, g.pass_number, g.pass_kind, g.status,
       g.gate_out_at, g.half_day_marked_at, g.attendance_effect AS effect, g.work_minutes_outside, g.attendance_marked_at
  FROM public.labour_gate_passes g
 WHERE g.attendance_effect IS NOT NULL;

GRANT SELECT ON public.v_labour_gate_pass_half_days TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.labour_gate_pass_half_day_exists(p_employee_id uuid, p_date date)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.labour_gate_passes g
     WHERE g.employee_id = p_employee_id AND g.pass_date = p_date AND g.attendance_effect = 'half_day');
$$;

CREATE OR REPLACE FUNCTION public.labour_gate_pass_absent_pass(p_employee_id uuid, p_date date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT g.pass_number FROM public.labour_gate_passes g
   WHERE g.employee_id = p_employee_id AND g.pass_date = p_date AND g.attendance_effect = 'absent'
   LIMIT 1;
$$;

-- Productivity rows: a date marked absent by a pass takes no rows at all; a
-- date marked half day keeps every row at half day.
CREATE OR REPLACE FUNCTION public.labour_productivity_force_half_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_absent text;
BEGIN
  v_absent := public.labour_gate_pass_absent_pass(NEW.employee_id, NEW.target_date);
  IF v_absent IS NOT NULL THEN
    RAISE EXCEPTION 'This worker is marked absent on % (outside over the limit on gate pass %): no productivity entry can be posted for that date.',
      to_char(NEW.target_date, 'DD Mon YYYY'), v_absent;
  END IF;
  IF NEW.work_type IS DISTINCT FROM 'half_day'
     AND public.labour_gate_pass_half_day_exists(NEW.employee_id, NEW.target_date) THEN
    NEW.work_type := 'half_day';
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Helpers -----------------------------------------------------------------

-- Minutes of [p_from, p_to] that fall inside the official hours of p_date.
CREATE OR REPLACE FUNCTION public.labour_gate_pass_work_minutes(p_from timestamptz, p_to timestamptz, p_date date)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.labour_gate_pass_settings%ROWTYPE;
  v_start timestamptz;
  v_end timestamptz;
  v_from timestamptz;
  v_to timestamptz;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN RETURN 0; END IF;
  SELECT * INTO s FROM public.labour_gate_pass_settings WHERE id;
  v_start := (p_date + s.day_start_time) AT TIME ZONE 'Asia/Karachi';
  v_end := (p_date + s.day_end_time) AT TIME ZONE 'Asia/Karachi';
  v_from := GREATEST(p_from, v_start);
  v_to := LEAST(p_to, v_end);
  IF v_to <= v_from THEN RETURN 0; END IF;
  RETURN FLOOR(EXTRACT(EPOCH FROM (v_to - v_from)) / 60)::integer;
END;
$$;

-- Day end of a pass date as a timestamp.
CREATE OR REPLACE FUNCTION public.labour_gate_pass_day_end_at(p_date date)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (p_date + s.day_end_time) AT TIME ZONE 'Asia/Karachi' FROM public.labour_gate_pass_settings s WHERE s.id;
$$;

-- 4. Marking ----------------------------------------------------------------------

-- Half day: every productivity row of the worker for the pass date becomes a
-- half day (as before), and the pass records the effect. Does nothing for
-- official duty or when the date is already absent.
CREATE OR REPLACE FUNCTION public.labour_gate_pass_mark_half_day(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.labour_gate_passes%ROWTYPE;
  v_out_time time;
  v_n integer := 0;
  v_approved integer := 0;
BEGIN
  SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id;
  IF NOT FOUND OR g.pass_kind = 'official_duty' OR g.attendance_effect = 'absent' THEN RETURN 0; END IF;
  v_out_time := (COALESCE(g.gate_out_at, now()) AT TIME ZONE 'Asia/Karachi')::time;

  SELECT count(*) INTO v_approved
    FROM public.labour_productivity_targets t
   WHERE t.employee_id = g.employee_id AND t.target_date = g.pass_date
     AND t.status = 'approved' AND t.work_type <> 'half_day';

  UPDATE public.labour_gate_passes
     SET attendance_effect = 'half_day', attendance_marked_at = COALESCE(attendance_marked_at, now()),
         half_day_marked_at = now(), updated_at = now()
   WHERE id = p_id;

  UPDATE public.labour_productivity_targets t
     SET work_type = 'half_day',
         check_out = COALESCE(t.check_out, v_out_time),
         remarks = CASE WHEN COALESCE(t.remarks, '') ILIKE '%' || g.pass_number || '%' THEN t.remarks
                        ELSE concat_ws(' · ', NULLIF(btrim(t.remarks), ''), 'Left on gate pass ' || g.pass_number) END,
         updated_at = now()
   WHERE t.employee_id = g.employee_id AND t.target_date = g.pass_date
     AND (t.work_type <> 'half_day' OR t.check_out IS NULL
          OR COALESCE(t.remarks, '') NOT ILIKE '%' || g.pass_number || '%');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.labour_gate_passes SET half_day_rows = v_n WHERE id = p_id;
  PERFORM public.labour_gate_pass_log(p_id, 'half_day_marked',
    'Marked Half day for ' || to_char(g.pass_date, 'DD Mon YYYY') || ': ' || v_n || ' productivity entr' ||
    CASE WHEN v_n = 1 THEN 'y' ELSE 'ies' END || ' set to half day' ||
    CASE WHEN v_approved > 0 THEN ' (' || v_approved || ' already approved)' ELSE '' END,
    jsonb_build_object('rows', v_n, 'approved_rows', v_approved));

  IF v_approved > 0 THEN
    PERFORM public.notify_role(ARRAY['super_admin','labour_productivity_approver']::app_role[],
      'Approved productivity entry changed to half day',
      public.labour_gate_pass_label(g) || ' is marked half day on ' || to_char(g.pass_date, 'DD Mon YYYY')
        || ' (gate pass). ' || v_approved || ' approved entr' || CASE WHEN v_approved = 1 THEN 'y was' ELSE 'ies were' END
        || ' changed to half day.',
      'warning', 'labour', '/labour/gate-pass/' || g.id::text, 'labour_gate_pass', g.id,
      public.app_user_id(), public.app_user_id());
  END IF;
  RETURN v_n;
END;
$$;

-- Absent: the worker's productivity rows for the pass date are deleted (a
-- snapshot goes into the pass history) and the trigger refuses new ones.
CREATE OR REPLACE FUNCTION public.labour_gate_pass_mark_absent(p_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.labour_gate_passes%ROWTYPE;
  v_rows jsonb;
  v_n integer := 0;
  v_approved integer := 0;
BEGIN
  SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id;
  IF NOT FOUND OR g.pass_kind = 'official_duty' OR g.attendance_effect = 'absent' THEN RETURN 0; END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb), count(*), count(*) FILTER (WHERE t.status = 'approved')
    INTO v_rows, v_n, v_approved
    FROM public.labour_productivity_targets t
   WHERE t.employee_id = g.employee_id AND t.target_date = g.pass_date;

  -- Mark first so the trigger does not re-shape rows while they are removed.
  UPDATE public.labour_gate_passes
     SET attendance_effect = 'absent', attendance_marked_at = now(), updated_at = now()
   WHERE id = p_id;

  DELETE FROM public.labour_productivity_targets t
   WHERE t.employee_id = g.employee_id AND t.target_date = g.pass_date;

  PERFORM public.labour_gate_pass_log(p_id, 'absent_marked',
    'Marked ABSENT for ' || to_char(g.pass_date, 'DD Mon YYYY') || ': ' || v_n || ' productivity entr' ||
    CASE WHEN v_n = 1 THEN 'y' ELSE 'ies' END || ' deleted' ||
    CASE WHEN v_approved > 0 THEN ' (' || v_approved || ' already approved)' ELSE '' END,
    jsonb_build_object('deleted_rows', v_n, 'approved_rows', v_approved, 'rows', v_rows));

  IF v_approved > 0 THEN
    PERFORM public.notify_role(ARRAY['super_admin','labour_productivity_approver']::app_role[],
      'Approved productivity entries deleted — worker absent',
      public.labour_gate_pass_label(g) || ' is marked absent on ' || to_char(g.pass_date, 'DD Mon YYYY')
        || ' (outside over the limit on a short leave). ' || v_approved || ' approved entr'
        || CASE WHEN v_approved = 1 THEN 'y was' ELSE 'ies were' END || ' deleted; the rows are kept in the pass history.',
      'warning', 'labour', '/labour/gate-pass/' || g.id::text, 'labour_gate_pass', g.id,
      public.app_user_id(), public.app_user_id());
  END IF;
  RETURN v_n;
END;
$$;

-- Apply the short-leave thresholds to a pass as of p_until (now, the gate-in
-- scan, or day end). Returns the effect in force afterwards.
CREATE OR REPLACE FUNCTION public.labour_gate_pass_apply_thresholds(p_id uuid, p_until timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.labour_gate_passes%ROWTYPE;
  s public.labour_gate_pass_settings%ROWTYPE;
  v_min integer;
  v_effect text;
BEGIN
  SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id;
  IF NOT FOUND OR g.pass_kind <> 'short_leave' OR g.gate_out_at IS NULL THEN
    RETURN g.attendance_effect;
  END IF;
  SELECT * INTO s FROM public.labour_gate_pass_settings WHERE id;
  v_min := public.labour_gate_pass_work_minutes(g.gate_out_at, LEAST(p_until, public.labour_gate_pass_day_end_at(g.pass_date)), g.pass_date);
  UPDATE public.labour_gate_passes SET work_minutes_outside = v_min WHERE id = p_id;

  v_effect := CASE WHEN v_min > s.absent_after_minutes THEN 'absent'
                   WHEN v_min > s.half_day_after_minutes THEN 'half_day' END;

  IF v_effect = 'absent' AND g.attendance_effect IS DISTINCT FROM 'absent' THEN
    PERFORM public.labour_gate_pass_mark_absent(p_id);
    PERFORM public.labour_gate_pass_log(p_id, 'threshold',
      'Outside ' || v_min || ' min of working time on a short leave — over ' || s.absent_after_minutes || ' min: counted as ABSENT');
    SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id;
    PERFORM public.labour_gate_pass_notify(g, 'Short leave over ' || (s.absent_after_minutes / 60) || ' hours — worker counted ABSENT',
      public.labour_gate_pass_label(g) || ' has been outside ' || v_min || ' min of working time on short leave. '
        || to_char(g.pass_date, 'DD Mon') || ' is now marked absent; the productivity entries for that date were deleted.',
      'error', true, true);
  ELSIF v_effect = 'half_day' AND g.attendance_effect IS NULL THEN
    PERFORM public.labour_gate_pass_mark_half_day(p_id);
    PERFORM public.labour_gate_pass_log(p_id, 'threshold',
      'Outside ' || v_min || ' min of working time on a short leave — over ' || s.half_day_after_minutes || ' min: counted as half day');
    SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id;
    PERFORM public.labour_gate_pass_notify(g, 'Short leave over ' || (s.half_day_after_minutes / 60) || ' hours — counted as half day',
      public.labour_gate_pass_label(g) || ' has been outside ' || v_min || ' min of working time on short leave. '
        || to_char(g.pass_date, 'DD Mon') || ' is now marked half day.',
      'warning', true, true);
  END IF;
  RETURN COALESCE(v_effect, g.attendance_effect);
END;
$$;

-- 5. Gate in ----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.labour_gate_pass_gate_in(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.labour_gate_passes%ROWTYPE;
  v_uid uuid := public.app_user_id();
  v_minutes integer;
  v_late integer;
  v_effect text;
BEGIN
  IF NOT public.labour_gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can use Gate Check.';
  END IF;
  SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status = 'returned' AND g.gate_in_by IS NOT DISTINCT FROM v_uid AND g.gate_in_at > now() - interval '10 seconds' THEN
    RETURN jsonb_build_object('status', 'returned', 'repeat', true, 'gate_in_at', g.gate_in_at,
      'minutes_outside', g.minutes_outside, 'late_minutes', GREATEST(0, EXTRACT(EPOCH FROM (g.gate_in_at - g.expected_back_at)) / 60)::integer,
      'attendance_effect', g.attendance_effect, 'work_minutes_outside', g.work_minutes_outside);
  END IF;
  IF g.pass_kind = 'half_day' THEN
    RAISE EXCEPTION 'Gate pass % is a half-day pass — the worker is not expected back today.', g.pass_number;
  END IF;
  IF g.status <> 'out' THEN
    RAISE EXCEPTION 'Gate pass % is % — there is nothing to scan in.', g.pass_number, replace(g.status, '_', ' ');
  END IF;

  v_minutes := CEIL(EXTRACT(EPOCH FROM (now() - g.gate_out_at)) / 60)::integer;
  v_late := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - g.expected_back_at)) / 60))::integer;
  UPDATE public.labour_gate_passes
     SET status = 'returned', gate_in_by = v_uid, gate_in_at = now(), minutes_outside = v_minutes, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.labour_gate_pass_log(p_id, 'in',
    'Back at gate after ' || v_minutes || ' min' || CASE WHEN v_late > 0 THEN ' (' || v_late || ' min late)' ELSE '' END,
    jsonb_build_object('minutes_outside', v_minutes, 'late_minutes', v_late));

  IF g.pass_kind = 'official_duty' THEN
    IF v_late > 0 THEN
      PERFORM public.labour_gate_pass_inform(g, 'Worker back from company work',
        public.labour_gate_pass_label(g) || ' came back at ' || public.labour_gate_pass_fmt(g.gate_in_at)
          || ' after ' || v_minutes || ' min' || COALESCE(' (' || g.destination || ')', '') || '.');
    ELSE
      PERFORM public.labour_gate_pass_notify(g, 'Worker back from company work',
        public.labour_gate_pass_label(g) || ' came back at ' || public.labour_gate_pass_fmt(g.gate_in_at)
          || ' after ' || v_minutes || ' min' || COALESCE(' (' || g.destination || ')', '') || '.',
        'info', true, false);
    END IF;
  ELSE
    v_effect := public.labour_gate_pass_apply_thresholds(p_id, now());
    SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id;
    PERFORM public.labour_gate_pass_notify(g, 'Worker back from short leave',
      public.labour_gate_pass_label(g) || ' came back at ' || public.labour_gate_pass_fmt(g.gate_in_at)
        || ' after ' || v_minutes || ' min' || CASE WHEN v_late > 0 THEN ' (' || v_late || ' min late)' ELSE '' END
        || CASE WHEN v_effect = 'absent' THEN '. The day counts as ABSENT.'
                WHEN v_effect = 'half_day' THEN '. The day counts as a half day.' ELSE '.' END,
      CASE WHEN v_effect IS NOT NULL OR v_late > 0 THEN 'warning' ELSE 'info' END, true, v_late > 0);
  END IF;

  RETURN jsonb_build_object('status', 'returned', 'repeat', false, 'gate_in_at', g.gate_in_at,
    'minutes_outside', v_minutes, 'late_minutes', v_late,
    'attendance_effect', g.attendance_effect, 'work_minutes_outside', g.work_minutes_outside);
END;
$$;

-- 6. Scheduled tick -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.labour_gate_pass_tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.labour_gate_pass_settings%ROWTYPE;
  g public.labour_gate_passes%ROWTYPE;
  v_today date := public.labour_gate_pass_today();
  v_time time := (now() AT TIME ZONE 'Asia/Karachi')::time;
  v_overdue integer := 0;
  v_expired integer := 0;
  v_not_returned integer := 0;
  v_thresholds integer := 0;
  v_late integer;
  v_effect text;
BEGIN
  SELECT * INTO s FROM public.labour_gate_pass_settings WHERE id;

  -- Late back: one notice per pass once expected time + grace has passed.
  FOR g IN
    SELECT * FROM public.labour_gate_passes
     WHERE status = 'out' AND pass_kind IN ('short_leave','official_duty') AND overdue_notified_at IS NULL
       AND expected_back_at + make_interval(mins => s.grace_minutes) < now()
     FOR UPDATE SKIP LOCKED
  LOOP
    v_late := CEIL(EXTRACT(EPOCH FROM (now() - g.expected_back_at)) / 60)::integer;
    UPDATE public.labour_gate_passes SET overdue_notified_at = now(), updated_at = now() WHERE id = g.id;
    PERFORM public.labour_gate_pass_log(g.id, 'overdue', 'Not back ' || v_late || ' min after the expected return');
    IF g.pass_kind = 'official_duty' THEN
      PERFORM public.labour_gate_pass_inform(g, 'Worker still out on company work',
        public.labour_gate_pass_label(g) || ' went out at ' || public.labour_gate_pass_fmt(g.gate_out_at)
          || COALESCE(' for ' || g.destination, '') || ' and is ' || v_late || ' min past the expected return.');
    ELSE
      PERFORM public.labour_gate_pass_notify(g, 'Worker late back from short leave',
        public.labour_gate_pass_label(g) || ' went out at ' || public.labour_gate_pass_fmt(g.gate_out_at)
          || ' and is ' || v_late || ' min past the expected return.', 'warning', true, true);
    END IF;
    v_overdue := v_overdue + 1;
  END LOOP;

  -- Short leaves still out: apply the 3 h / 6 h thresholds live.
  FOR g IN
    SELECT * FROM public.labour_gate_passes
     WHERE status = 'out' AND pass_kind = 'short_leave' AND pass_date = v_today
       AND attendance_effect IS DISTINCT FROM 'absent'
     FOR UPDATE SKIP LOCKED
  LOOP
    v_effect := public.labour_gate_pass_apply_thresholds(g.id, now());
    IF v_effect IS DISTINCT FROM g.attendance_effect THEN v_thresholds := v_thresholds + 1; END IF;
  END LOOP;

  -- Day close: passes for a past date, or for today after the day-end time.
  FOR g IN
    SELECT * FROM public.labour_gate_passes
     WHERE status IN ('pending_approval','approved','out')
       AND (pass_date < v_today OR (pass_date = v_today AND v_time >= s.day_end_time))
       AND NOT (status = 'out' AND pass_kind = 'half_day')
     ORDER BY pass_date
     FOR UPDATE SKIP LOCKED
  LOOP
    IF g.status IN ('pending_approval','approved') THEN
      UPDATE public.labour_gate_passes
         SET status = 'expired', closed_at = now(),
             close_note = CASE WHEN g.status = 'approved' THEN 'Not used by day end' ELSE 'Not approved by day end' END,
             updated_at = now()
       WHERE id = g.id RETURNING * INTO g;
      PERFORM public.labour_gate_pass_log(g.id, 'expired', g.close_note);
      PERFORM public.labour_gate_pass_notify(g, 'Worker gate pass expired',
        public.labour_gate_pass_label(g) || ' for ' || to_char(g.pass_date, 'DD Mon') || ': ' || g.close_note || '.',
        'info', true, g.close_note = 'Not approved by day end');
      v_expired := v_expired + 1;
    ELSIF g.pass_kind = 'official_duty' THEN
      UPDATE public.labour_gate_passes
         SET status = 'not_returned', closed_at = now(), close_note = 'Not scanned in by day end — company work', updated_at = now()
       WHERE id = g.id RETURNING * INTO g;
      PERFORM public.labour_gate_pass_log(g.id, 'not_returned', 'Not scanned in by day end — company work, attendance not affected');
      PERFORM public.labour_gate_pass_inform(g, 'Worker not scanned back in from company work',
        public.labour_gate_pass_label(g) || ' went out at ' || public.labour_gate_pass_fmt(g.gate_out_at)
          || COALESCE(' for ' || g.destination, '') || ' and was not scanned back in by day end. Attendance is not affected.');
      v_not_returned := v_not_returned + 1;
    ELSE
      -- Short leave still out at day end: the time outside up to day end decides.
      v_effect := public.labour_gate_pass_apply_thresholds(g.id, public.labour_gate_pass_day_end_at(g.pass_date));
      UPDATE public.labour_gate_passes
         SET status = 'not_returned', closed_at = now(), close_note = 'Still out at day end', updated_at = now()
       WHERE id = g.id RETURNING * INTO g;
      PERFORM public.labour_gate_pass_log(g.id, 'not_returned', 'Still out at day end — ' || g.work_minutes_outside || ' min of working time outside'
        || CASE v_effect WHEN 'absent' THEN ' — absent' WHEN 'half_day' THEN ' — half day' ELSE ' — no attendance effect' END);
      PERFORM public.labour_gate_pass_notify(g, 'Worker did not come back from short leave',
        public.labour_gate_pass_label(g) || ' went out at ' || public.labour_gate_pass_fmt(g.gate_out_at)
          || ' and was not scanned back in by day end (' || g.work_minutes_outside || ' min of working time outside).'
          || CASE v_effect WHEN 'absent' THEN ' ' || to_char(g.pass_date, 'DD Mon') || ' is marked absent.'
                           WHEN 'half_day' THEN ' ' || to_char(g.pass_date, 'DD Mon') || ' is marked half day.'
                           ELSE ' Attendance is not affected.' END,
        'warning', true, true);
      v_not_returned := v_not_returned + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('overdue', v_overdue, 'thresholds', v_thresholds, 'expired', v_expired, 'not_returned', v_not_returned);
END;
$$;

-- 7. Settings (super admin): any subset of keys -------------------------------------

CREATE OR REPLACE FUNCTION public.labour_gate_pass_settings_update(p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the labour gate pass settings.';
  END IF;
  UPDATE public.labour_gate_pass_settings
     SET default_expected_minutes = COALESCE((p->>'default_expected_minutes')::integer, default_expected_minutes),
         official_default_expected_minutes = COALESCE((p->>'official_default_expected_minutes')::integer, official_default_expected_minutes),
         grace_minutes = COALESCE((p->>'grace_minutes')::integer, grace_minutes),
         day_start_time = COALESCE((p->>'day_start_time')::time, day_start_time),
         day_end_time = COALESCE((p->>'day_end_time')::time, day_end_time),
         half_day_after_minutes = COALESCE((p->>'half_day_after_minutes')::integer, half_day_after_minutes),
         absent_after_minutes = COALESCE((p->>'absent_after_minutes')::integer, absent_after_minutes),
         auto_half_day_not_returned = COALESCE((p->>'auto_half_day_not_returned')::boolean, auto_half_day_not_returned),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 8. Grants ----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.labour_gate_pass_absent_pass(uuid, date),
  public.labour_gate_pass_settings_update(jsonb)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.labour_gate_pass_work_minutes(timestamptz, timestamptz, date),
  public.labour_gate_pass_day_end_at(date),
  public.labour_gate_pass_mark_absent(uuid),
  public.labour_gate_pass_apply_thresholds(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.labour_gate_pass_work_minutes(timestamptz, timestamptz, date),
  public.labour_gate_pass_day_end_at(date),
  public.labour_gate_pass_mark_absent(uuid),
  public.labour_gate_pass_apply_thresholds(uuid, timestamptz)
  TO service_role;
