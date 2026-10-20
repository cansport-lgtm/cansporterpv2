-- ============================================================================
-- Staff official timing: late grace per employee
-- ----------------------------------------------------------------------------
-- Every staff member already has their own official timing on the employees
-- table (duty_start_time, duty_end_time, duty_hours). late_grace_minutes is how
-- long after duty_start_time they may check in before counting as late. It
-- defaults to 15 min, which matches the old fixed 09:15 cut-off for 09:00 staff.
--
-- Edited on HR → Employees (form and the Official Timings bulk editor); read by
-- the Attendance page (Late suggestion) and Punctuality Analytics.
--
-- Rollback: supabase/rollbacks/20261106120000_staff_late_grace_minutes_down.sql
-- ============================================================================

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS late_grace_minutes integer NOT NULL DEFAULT 15
  CHECK (late_grace_minutes BETWEEN 0 AND 240);
COMMENT ON COLUMN public.employees.late_grace_minutes IS
  'Minutes after duty_start_time a staff member may check in before counting as late.';
