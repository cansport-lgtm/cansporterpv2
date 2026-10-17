-- Rollback for 20261101120000_staff_travel_allowance.sql
-- Removes the claim guard and the travel allowance switch: every staff member
-- on an official duty pass can claim trip fuel again.

DROP TRIGGER IF EXISTS staff_trip_fuel_allowance_guard ON public.staff_trip_fuel_vouchers;
DROP FUNCTION IF EXISTS public.staff_trip_fuel_allowance_guard();
ALTER TABLE public.employees DROP COLUMN IF EXISTS travel_allowance_allowed;
