-- Rollback for 20261103120000_trip_fuel_gate_pass_approver.sql
-- Approval goes back to the HR manager (and super admin) only.
--
-- 1. Put the earlier function definitions back (all CREATE OR REPLACE):
--      * section 3 of supabase/migrations/20261006120000_staff_trip_fuel.sql
--        (staff_trip_fuel_can, staff_trip_fuel_notify)
--      * sections 2 and 3 of supabase/migrations/20261015120000_trip_fuel_approval_final.sql
--        (staff_trip_fuel_review, staff_trip_fuel_cancel)
-- 2. Then run the statements below. Dropping approved_as loses only the role
--    label; approved_by / approved_at (who and when) stay on every voucher.

DROP FUNCTION IF EXISTS public.staff_trip_fuel_approver_role();
ALTER TABLE public.staff_trip_fuel_vouchers DROP COLUMN IF EXISTS approved_as;
