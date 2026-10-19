-- Rollback for 20261104120000_labour_gate_pass_remove_half_day.sql
-- Puts the half day back on every pass that lost it (repair or by hand).

UPDATE public.labour_gate_passes g
   SET attendance_effect = 'half_day',
       attendance_marked_at = COALESCE(g.closed_at, g.gate_out_at),
       half_day_marked_at = COALESCE(g.closed_at, g.gate_out_at),
       updated_at = now()
 WHERE g.attendance_effect IS NULL
   AND EXISTS (SELECT 1 FROM public.labour_gate_pass_events ev
                WHERE ev.pass_id = g.id AND ev.event = 'half_day_removed');

DELETE FROM public.labour_gate_pass_events WHERE event = 'half_day_removed';

DROP FUNCTION IF EXISTS public.labour_gate_pass_remove_half_day(uuid, text);
