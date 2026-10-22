-- ============================================================================
-- Private Label Sales: fuel voucher by price × factor, meter photos, planner
-- ----------------------------------------------------------------------------
-- Fuel trips (sales_fuel_trips) used to be paid as (km ÷ vehicle mileage) ×
-- the fuel price from the super admin's price list, worked out only at
-- approval. From now on the salesman types the pump price of the day on the
-- trip, the super admin keeps a multiplying factor, and
--
--     rate per km = petrol price (salesman) × factor (super admin)
--     amount      = km × rate per km
--
-- is worked out when the trip is posted, so the voucher prints at once. The
-- price, the factor and the rate are frozen on the trip: a later change of
-- the factor never moves an old voucher. Each trip now carries a voucher
-- number (SFV-YY-0001 …) and the two vehicle-meter photos (start, end) the
-- salesman must upload. Photos go to the existing public bucket
-- trip-odometer-photos (20261006120000_staff_trip_fuel.sql).
--
-- The salesman planner (sales_salesman_plans) is a free-text plan, one line
-- per point, for a day, a week or any range, kept per salesman and printed.
--
-- Rollback: supabase/rollbacks/20261112120000_sales_fuel_rate_factor_planner_down.sql
--
-- Applied to the live project in four parts (sales_fuel_rate_factor_1_factors,
-- _2_trip_columns_voucher_no, _3_snapshot, _4_planner). No DROP statements on
-- purpose: the apply tool stalls on them; CREATE OR REPLACE TRIGGER is used instead.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Multiplying factor (super admin): dated, so history is kept
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_fuel_rate_factors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  factor NUMERIC(10,4) NOT NULL CHECK (factor > 0),
  note TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_fuel_rate_factors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sfrf_all" ON public.sales_fuel_rate_factors FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE OR REPLACE TRIGGER sfrf_updated BEFORE UPDATE ON public.sales_fuel_rate_factors
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_sfrf_effective ON public.sales_fuel_rate_factors(effective_date DESC);

-- ---------------------------------------------------------------------------
-- 2. Trip columns: entered price, frozen factor and rate, photos, voucher no.
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_fuel_trips
  ADD COLUMN IF NOT EXISTS fuel_price_entered NUMERIC,
  ADD COLUMN IF NOT EXISTS rate_factor_snapshot NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS rate_per_km NUMERIC,
  ADD COLUMN IF NOT EXISTS odo_start_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS odo_end_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS voucher_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sft_voucher_number ON public.sales_fuel_trips(voucher_number);

-- Voucher numbering: SFV-YY-0001 per calendar year of posting.
CREATE OR REPLACE FUNCTION public.generate_sales_fuel_voucher_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_year TEXT; v_max INTEGER;
BEGIN
  IF NEW.voucher_number IS NOT NULL AND NEW.voucher_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN voucher_number LIKE 'SFV-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(voucher_number FROM 8), '')::INTEGER ELSE 0 END
  ), 0) + 1 INTO v_max
  FROM public.sales_fuel_trips
  WHERE voucher_number LIKE 'SFV-' || v_year || '-%';
  NEW.voucher_number := 'SFV-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER sft_voucher_number BEFORE INSERT ON public.sales_fuel_trips
FOR EACH ROW EXECUTE FUNCTION public.generate_sales_fuel_voucher_number();

-- ---------------------------------------------------------------------------
-- 3. Snapshot at posting: price × factor = rate; km × rate = amount
-- ---------------------------------------------------------------------------
-- Replaces the approval-time snapshot. Runs on insert and on every update
-- until the trip is on a payout (payout_id) or Paid, so an edit to the
-- odometer or the price before approval re-prices the voucher. The vehicle
-- mileage and litres are still filled in for the weekly payout report.
CREATE OR REPLACE FUNCTION public.sales_fuel_trip_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_mileage NUMERIC; v_price NUMERIC; v_factor NUMERIC; v_km NUMERIC;
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.payout_id IS NOT NULL OR OLD.status = 'Paid') THEN
    -- Frozen: only the status / payout bookkeeping may move.
    IF NEW.status = 'Approved' AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
    RETURN NEW;
  END IF;

  v_km := GREATEST(COALESCE(NEW.end_odometer,0) - COALESCE(NEW.start_odometer,0), 0);

  -- Vehicle mileage (for the litres figure on payouts only).
  SELECT mileage_kmpl INTO v_mileage FROM public.sales_fuel_vehicles
  WHERE (NEW.vehicle_id IS NOT NULL AND id = NEW.vehicle_id)
     OR (NEW.vehicle_id IS NULL AND user_id = NEW.user_id AND is_active = true)
  ORDER BY is_active DESC, updated_at DESC LIMIT 1;
  NEW.mileage_kmpl_snapshot := COALESCE(v_mileage, NEW.mileage_kmpl_snapshot, 0);

  -- Petrol price: what the salesman typed, else the price list for the day.
  IF NEW.fuel_price_entered IS NOT NULL AND NEW.fuel_price_entered > 0 THEN
    v_price := NEW.fuel_price_entered;
  ELSE
    SELECT price_per_litre INTO v_price FROM public.sales_fuel_prices
    WHERE effective_date <= NEW.trip_date
    ORDER BY effective_date DESC LIMIT 1;
  END IF;
  NEW.fuel_price_snapshot := COALESCE(v_price, 0);

  -- Multiplying factor in force on the trip date (super admin).
  SELECT factor INTO v_factor FROM public.sales_fuel_rate_factors
  WHERE effective_date <= NEW.trip_date
  ORDER BY effective_date DESC, created_at DESC LIMIT 1;

  IF v_factor IS NOT NULL THEN
    NEW.rate_factor_snapshot := v_factor;
    NEW.rate_per_km := ROUND(NEW.fuel_price_snapshot * v_factor, 2);
    NEW.amount := ROUND(v_km * NEW.rate_per_km, 2);
    NEW.litres := CASE WHEN COALESCE(NEW.mileage_kmpl_snapshot,0) > 0 THEN v_km / NEW.mileage_kmpl_snapshot ELSE NULL END;
  ELSE
    -- No factor set yet: fall back to the old mileage formula so nothing is unpaid.
    NEW.rate_factor_snapshot := NULL;
    IF COALESCE(NEW.mileage_kmpl_snapshot,0) > 0 THEN
      NEW.litres := v_km / NEW.mileage_kmpl_snapshot;
      NEW.amount := ROUND(NEW.litres * NEW.fuel_price_snapshot, 2);
      NEW.rate_per_km := CASE WHEN v_km > 0 THEN ROUND(NEW.amount / v_km, 2) ELSE NULL END;
    ELSE
      NEW.litres := 0; NEW.amount := 0; NEW.rate_per_km := NULL;
    END IF;
  END IF;

  IF NEW.status = 'Approved' AND NEW.approved_at IS NULL THEN NEW.approved_at := now(); END IF;
  RETURN NEW;
END;
$$;
-- The trigger sft_snapshot (BEFORE INSERT OR UPDATE) already points at this function.

-- ---------------------------------------------------------------------------
-- 4. Salesman planner
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_salesman_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_number TEXT UNIQUE,
  user_id UUID NOT NULL,
  plan_kind TEXT NOT NULL DEFAULT 'day' CHECK (plan_kind IN ('day','week','custom')),
  from_date DATE NOT NULL DEFAULT CURRENT_DATE,
  to_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Submitted')),
  submitted_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
ALTER TABLE public.sales_salesman_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ssp_all" ON public.sales_salesman_plans FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE OR REPLACE TRIGGER ssp_updated BEFORE UPDATE ON public.sales_salesman_plans
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_ssp_user_from ON public.sales_salesman_plans(user_id, from_date DESC);

CREATE OR REPLACE FUNCTION public.generate_sales_salesman_plan_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_year TEXT; v_max INTEGER;
BEGIN
  IF NEW.plan_number IS NOT NULL AND NEW.plan_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN plan_number LIKE 'PLN-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(plan_number FROM 8), '')::INTEGER ELSE 0 END
  ), 0) + 1 INTO v_max
  FROM public.sales_salesman_plans
  WHERE plan_number LIKE 'PLN-' || v_year || '-%';
  NEW.plan_number := 'PLN-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER ssp_number BEFORE INSERT ON public.sales_salesman_plans
FOR EACH ROW EXECUTE FUNCTION public.generate_sales_salesman_plan_number();
