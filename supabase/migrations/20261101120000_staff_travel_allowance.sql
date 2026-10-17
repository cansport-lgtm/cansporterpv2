-- ============================================================================
-- Staff travel allowance: who may claim a Trip Fuel Voucher
-- ----------------------------------------------------------------------------
-- employees.travel_allowance_allowed (switch on the Employees page) marks the
-- staff members who are paid travel allowance. Only they can have a trip fuel
-- voucher (TFV-…): the claim is refused for everyone else, whether the staff
-- member raises it under Self Service or HR raises it for them. Vouchers that
-- already exist are not touched and can still be printed.
--
-- Staff who already have a live voucher (pending, approved or paid) start with
-- the switch on, so nobody loses access when this goes live.
--
-- Rollback: supabase/rollbacks/20261101120000_staff_travel_allowance_down.sql
-- ============================================================================

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS travel_allowance_allowed boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.employees.travel_allowance_allowed IS
  'Paid travel allowance: may claim trip fuel vouchers on official duty passes and sees My Travel Vouchers under Self Service.';

UPDATE public.employees e
   SET travel_allowance_allowed = true
 WHERE NOT e.travel_allowance_allowed
   AND EXISTS (SELECT 1 FROM public.staff_trip_fuel_vouchers v
                WHERE v.employee_id = e.id AND v.status IN ('pending_approval','approved','paid'));

-- New vouchers only: staff_trip_fuel_claim inserts, every other change is an update.
CREATE OR REPLACE FUNCTION public.staff_trip_fuel_allowance_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_name text;
  v_allowed boolean;
BEGIN
  SELECT full_name, COALESCE(travel_allowance_allowed, false) INTO v_name, v_allowed
    FROM public.employees WHERE id = NEW.employee_id;
  IF NOT COALESCE(v_allowed, false) THEN
    RAISE EXCEPTION 'Travel allowance is not enabled for %. HR turns it on on the Employees page.', COALESCE(v_name, 'this staff member');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_trip_fuel_allowance_guard ON public.staff_trip_fuel_vouchers;
CREATE TRIGGER staff_trip_fuel_allowance_guard
  BEFORE INSERT ON public.staff_trip_fuel_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.staff_trip_fuel_allowance_guard();
