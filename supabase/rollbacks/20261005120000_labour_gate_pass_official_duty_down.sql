-- Rollback for 20261005120000_labour_gate_pass_official_duty.sql
-- Restores the 6-argument apply / 4-argument settings_save / 7-argument notify
-- and the half-day predicates of 20261002120100_labour_gate_pass.sql.
-- Official duty passes already made are NOT deleted: the kind check below
-- fails while any exist, so cancel or wait for them to close first.

DROP FUNCTION IF EXISTS public.labour_gate_pass_apply(uuid, text, text, integer, time, date, text);
DROP FUNCTION IF EXISTS public.labour_gate_pass_settings_save(integer, integer, time, boolean, integer);
DROP FUNCTION IF EXISTS public.labour_gate_pass_notify(public.labour_gate_passes, text, text, text, boolean, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.labour_gate_pass_kind_text(public.labour_gate_passes);

ALTER TABLE public.labour_gate_passes DROP CONSTRAINT IF EXISTS labour_gate_passes_pass_kind_check;
ALTER TABLE public.labour_gate_passes
  ADD CONSTRAINT labour_gate_passes_pass_kind_check CHECK (pass_kind IN ('half_day','short_leave'));
ALTER TABLE public.labour_gate_passes DROP COLUMN IF EXISTS destination;
ALTER TABLE public.labour_gate_pass_settings DROP COLUMN IF EXISTS official_default_expected_minutes;
ALTER TABLE public.labour_employees DROP COLUMN IF EXISTS field_duty_allowed;

DROP INDEX IF EXISTS public.labour_gate_passes_half_day_idx;
CREATE INDEX IF NOT EXISTS labour_gate_passes_half_day_idx
  ON public.labour_gate_passes (employee_id, pass_date)
  WHERE (pass_kind = 'half_day' AND status = 'out') OR status = 'not_returned';

CREATE OR REPLACE VIEW public.v_labour_gate_pass_half_days AS
SELECT g.employee_id, g.pass_date, g.id AS pass_id, g.pass_number, g.pass_kind, g.status,
       g.gate_out_at, g.half_day_marked_at
  FROM public.labour_gate_passes g
 WHERE (g.pass_kind = 'half_day' AND g.status = 'out') OR g.status = 'not_returned';

-- Re-run sections 3 to 9 of 20261002120100_labour_gate_pass.sql to restore the
-- original half_day_exists, notify, mark_half_day, apply, cancel, gate_out,
-- gate_in, tick and settings_save functions.
