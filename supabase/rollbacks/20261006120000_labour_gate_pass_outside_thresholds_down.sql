-- Rollback for 20261006120000_labour_gate_pass_outside_thresholds.sql
-- Productivity rows deleted by an absent mark are NOT restored automatically;
-- each deletion's snapshot is in labour_gate_pass_events (event
-- 'absent_marked', details.rows) if they must be re-entered.

DROP FUNCTION IF EXISTS public.labour_gate_pass_settings_update(jsonb);
DROP FUNCTION IF EXISTS public.labour_gate_pass_apply_thresholds(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.labour_gate_pass_mark_absent(uuid);
DROP FUNCTION IF EXISTS public.labour_gate_pass_day_end_at(date);
DROP FUNCTION IF EXISTS public.labour_gate_pass_work_minutes(timestamptz, timestamptz, date);
DROP FUNCTION IF EXISTS public.labour_gate_pass_absent_pass(uuid, date);

CREATE OR REPLACE VIEW public.v_labour_gate_pass_half_days AS
SELECT g.employee_id, g.pass_date, g.id AS pass_id, g.pass_number, g.pass_kind, g.status,
       g.gate_out_at, g.half_day_marked_at
  FROM public.labour_gate_passes g
 WHERE (g.pass_kind = 'half_day' AND g.status = 'out') OR (g.pass_kind <> 'official_duty' AND g.status = 'not_returned');

DROP INDEX IF EXISTS public.labour_gate_passes_effect_idx;
ALTER TABLE public.labour_gate_passes
  DROP COLUMN IF EXISTS attendance_effect,
  DROP COLUMN IF EXISTS attendance_marked_at,
  DROP COLUMN IF EXISTS work_minutes_outside;
ALTER TABLE public.labour_gate_pass_settings
  DROP COLUMN IF EXISTS day_start_time,
  DROP COLUMN IF EXISTS half_day_after_minutes,
  DROP COLUMN IF EXISTS absent_after_minutes;
UPDATE public.labour_gate_pass_settings SET day_end_time = '18:00';

-- Re-run sections 2 and 3 of 20261005120000_labour_gate_pass_official_duty.sql
-- to restore half_day_exists, the productivity trigger function,
-- mark_half_day, gate_in and tick.
