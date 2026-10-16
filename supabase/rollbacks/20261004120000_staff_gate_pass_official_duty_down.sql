-- Rollback for 20261004120000_staff_gate_pass_official_duty.sql.
-- Restores the functions of 20261003120100_staff_gate_pass.sql (re-run that
-- migration's sections 2–9 afterwards, or apply it again: it is idempotent).
-- Existing official_duty passes are kept; the CHECK constraint is only
-- re-tightened when none exist.

DROP FUNCTION IF EXISTS public.staff_gate_pass_settings_save(integer, integer, time, boolean, integer);
DROP FUNCTION IF EXISTS public.staff_gate_pass_apply(uuid, text, text, integer, time, date, text);
DROP FUNCTION IF EXISTS public.staff_gate_pass_notify(public.staff_gate_passes, text, text, text, boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.staff_gate_pass_kind_text(public.staff_gate_passes);
DROP FUNCTION IF EXISTS public.staff_gate_pass_is_self(uuid);

ALTER TABLE public.staff_gate_pass_settings DROP COLUMN IF EXISTS official_default_expected_minutes;
ALTER TABLE public.employees DROP COLUMN IF EXISTS field_duty_allowed;
ALTER TABLE public.staff_gate_passes DROP COLUMN IF EXISTS destination;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_gate_passes WHERE pass_kind = 'official_duty') THEN
    ALTER TABLE public.staff_gate_passes DROP CONSTRAINT IF EXISTS staff_gate_passes_pass_kind_check;
    ALTER TABLE public.staff_gate_passes
      ADD CONSTRAINT staff_gate_passes_pass_kind_check CHECK (pass_kind IN ('half_day','short_leave'));
  END IF;
END $$;

-- Then re-apply supabase/migrations/20261003120100_staff_gate_pass.sql to restore
-- the previous apply / cancel / gate_out / gate_in / tick / settings_save / notify
-- functions, the half-day view, index and helper.
