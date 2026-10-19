-- Rollback for 20261103120000_staff_gate_pass_outside_thresholds.sql
-- HR attendance rows set to Absent by a pass are NOT restored automatically;
-- each one's previous status is in staff_gate_pass_events (event
-- 'absent_marked', details.previous_status) if it must be corrected.

DROP FUNCTION IF EXISTS public.staff_gate_pass_settings_update(jsonb);
DROP FUNCTION IF EXISTS public.staff_gate_pass_apply_thresholds(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.staff_gate_pass_mark_absent(uuid);
DROP FUNCTION IF EXISTS public.staff_gate_pass_official_end_at(date);
DROP FUNCTION IF EXISTS public.staff_gate_pass_work_minutes(timestamptz, timestamptz, date);

-- The view loses its new columns: drop and recreate it as before.
DROP VIEW IF EXISTS public.v_staff_gate_pass_half_days;
CREATE VIEW public.v_staff_gate_pass_half_days AS
SELECT g.employee_id, g.pass_date, g.id AS pass_id, g.pass_number, g.pass_kind, g.status,
       g.gate_out_at, g.half_day_marked_at
  FROM public.staff_gate_passes g
 WHERE (g.pass_kind = 'half_day' AND g.status = 'out') OR (g.pass_kind <> 'official_duty' AND g.status = 'not_returned');
GRANT SELECT ON public.v_staff_gate_pass_half_days TO anon, authenticated, service_role;

-- Restore the half-day-only attendance trigger function before its helper goes.
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
DROP FUNCTION IF EXISTS public.staff_gate_pass_absent_pass(uuid, date);

DROP INDEX IF EXISTS public.staff_gate_passes_effect_idx;
ALTER TABLE public.staff_gate_passes
  DROP COLUMN IF EXISTS attendance_effect,
  DROP COLUMN IF EXISTS attendance_marked_at,
  DROP COLUMN IF EXISTS work_minutes_outside;
ALTER TABLE public.staff_gate_pass_settings
  DROP COLUMN IF EXISTS day_start_time,
  DROP COLUMN IF EXISTS official_end_time,
  DROP COLUMN IF EXISTS half_day_after_minutes,
  DROP COLUMN IF EXISTS absent_after_minutes;

-- Re-run sections 1, 3, 6 and 7 of 20261004120000_staff_gate_pass_official_duty.sql
-- to restore half_day_exists, mark_half_day, gate_in and tick.
