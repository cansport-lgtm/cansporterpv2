-- ============================================================================
-- Staff Gate Pass: a short leave can no longer be converted to a half day
-- ----------------------------------------------------------------------------
-- The approver's "Did not return · mark half day" action is removed for staff.
-- A short leave affects HR attendance only through the time-outside rule
-- (20261103130000_staff_gate_pass_outside_thresholds.sql): over 3 h outside in
-- office hours → half day, over 8 h → absent, otherwise no effect — also when
-- the staff member is not back by day end. Half-day passes are unchanged.
--
-- staff_gate_pass_convert_half_day keeps its signature (older app builds may
-- still call it) but now refuses. Worker passes keep their convert action.
-- Rollback: supabase/rollbacks/20261107120000_staff_gate_pass_no_short_leave_convert_down.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.staff_gate_pass_convert_half_day(p_id uuid, p_reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'A staff short leave cannot be converted to a half day. Attendance follows the time outside: over 3 h half day, over 8 h absent.';
END;
$$;
