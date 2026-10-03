-- ============================================================================
-- Labour Attendance Delete Requests: approver role
-- ----------------------------------------------------------------------------
--   labour_attendance_delete_approver → approve / reject a supervisor's request
--                                       to delete a worker's attendance entry
--                                       that was marked by mistake.
--
-- Supervisors (floor_incharge, labour_productivity_poster,
-- labour_productivity_approver) cannot delete a daily entry themselves: they
-- raise a request with a reason, and this role (or a super admin) approves it.
-- The tables and functions are added in
-- 20261006120100_labour_attendance_delete_requests.sql — a new enum value
-- can't be referenced in the transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'labour_attendance_delete_approver';
