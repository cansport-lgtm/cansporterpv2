-- Rollback for 20261112120000_sales_fuel_rate_factor_planner.sql
-- Restores the approval-time mileage snapshot, drops the factor table, the
-- planner and the new trip columns (prices, photos and voucher numbers typed
-- on trips are lost).

DROP TRIGGER IF EXISTS ssp_number ON public.sales_salesman_plans;
DROP FUNCTION IF EXISTS public.generate_sales_salesman_plan_number();
DROP TABLE IF EXISTS public.sales_salesman_plans;

DROP TRIGGER IF EXISTS sft_voucher_number ON public.sales_fuel_trips;
DROP FUNCTION IF EXISTS public.generate_sales_fuel_voucher_number();

CREATE OR REPLACE FUNCTION public.sales_fuel_trip_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_mileage NUMERIC; v_price NUMERIC; v_km NUMERIC;
BEGIN
  IF NEW.status = 'Approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Approved') THEN
    IF NEW.mileage_kmpl_snapshot IS NULL OR NEW.mileage_kmpl_snapshot = 0 THEN
      SELECT mileage_kmpl INTO v_mileage FROM public.sales_fuel_vehicles
      WHERE (NEW.vehicle_id IS NOT NULL AND id = NEW.vehicle_id)
         OR (NEW.vehicle_id IS NULL AND user_id = NEW.user_id AND is_active = true)
      ORDER BY is_active DESC, updated_at DESC LIMIT 1;
      NEW.mileage_kmpl_snapshot := COALESCE(v_mileage, 0);
    END IF;
    IF NEW.fuel_price_snapshot IS NULL OR NEW.fuel_price_snapshot = 0 THEN
      SELECT price_per_litre INTO v_price FROM public.sales_fuel_prices
      WHERE effective_date <= NEW.trip_date
      ORDER BY effective_date DESC LIMIT 1;
      NEW.fuel_price_snapshot := COALESCE(v_price, 0);
    END IF;
    v_km := GREATEST(COALESCE(NEW.end_odometer,0) - COALESCE(NEW.start_odometer,0), 0);
    IF COALESCE(NEW.mileage_kmpl_snapshot,0) > 0 THEN
      NEW.litres := v_km / NEW.mileage_kmpl_snapshot;
      NEW.amount := NEW.litres * COALESCE(NEW.fuel_price_snapshot,0);
    ELSE
      NEW.litres := 0; NEW.amount := 0;
    END IF;
    IF NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP INDEX IF EXISTS public.idx_sft_voucher_number;
ALTER TABLE public.sales_fuel_trips
  DROP COLUMN IF EXISTS fuel_price_entered,
  DROP COLUMN IF EXISTS rate_factor_snapshot,
  DROP COLUMN IF EXISTS rate_per_km,
  DROP COLUMN IF EXISTS odo_start_photo_url,
  DROP COLUMN IF EXISTS odo_end_photo_url,
  DROP COLUMN IF EXISTS voucher_number;

DROP TABLE IF EXISTS public.sales_fuel_rate_factors;
