-- Rollback for 20261003120100_staff_gate_pass.sql (and the role in
-- 20261003120000_staff_gate_pass_roles.sql, which cannot be removed: enum
-- values stay; unassign the role from users instead).
--
-- HR attendance rows already set to half day by a pass keep that value; the
-- remark "Left on gate pass SGP-…" stays on them. employees.photo_url and the
-- staff-photos bucket are kept (photos are harmless and the Employees page
-- tolerates the column either way); drop them by hand if really wanted.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'staff-gate-pass-tick';
  END IF;
END $$;

DROP TRIGGER IF EXISTS hr_attendance_force_half_day ON public.attendance;
DROP FUNCTION IF EXISTS public.hr_attendance_force_half_day();

DROP FUNCTION IF EXISTS public.staff_gate_pass_settings_save(integer, integer, time, boolean);
DROP FUNCTION IF EXISTS public.staff_gate_pass_tick();
DROP FUNCTION IF EXISTS public.staff_gate_pass_convert_half_day(uuid, text);
DROP FUNCTION IF EXISTS public.staff_gate_pass_log_rescan(uuid);
DROP FUNCTION IF EXISTS public.staff_gate_pass_gate_in(uuid);
DROP FUNCTION IF EXISTS public.staff_gate_pass_gate_out(uuid);
DROP FUNCTION IF EXISTS public.staff_gate_pass_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.staff_gate_pass_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.staff_gate_pass_apply(uuid, text, text, integer, time, date);
DROP FUNCTION IF EXISTS public.staff_gate_pass_mark_half_day(uuid);
DROP FUNCTION IF EXISTS public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.staff_gate_pass_day_end(uuid);
DROP FUNCTION IF EXISTS public.staff_gate_pass_half_day_exists(uuid, date);
DROP FUNCTION IF EXISTS public.staff_gate_pass_fmt(timestamptz);
DROP FUNCTION IF EXISTS public.staff_gate_pass_label(public.staff_gate_passes);
DROP FUNCTION IF EXISTS public.staff_gate_pass_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.staff_gate_pass_today();
DROP FUNCTION IF EXISTS public.staff_gate_pass_can(text);

DROP VIEW IF EXISTS public.v_staff_gate_pass_half_days;

DROP TABLE IF EXISTS public.staff_gate_pass_events;
DROP TABLE IF EXISTS public.staff_gate_pass_settings;
DROP TABLE IF EXISTS public.staff_gate_passes;
DROP SEQUENCE IF EXISTS public.staff_gate_pass_number_seq;
