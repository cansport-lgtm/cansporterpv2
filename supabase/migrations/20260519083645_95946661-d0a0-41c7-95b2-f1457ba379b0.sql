
-- Vehicles per salesperson
CREATE TABLE public.sales_fuel_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'Bike',
  registration_no TEXT,
  mileage_kmpl NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_fuel_vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sfv_all" ON public.sales_fuel_vehicles FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE TRIGGER sfv_updated BEFORE UPDATE ON public.sales_fuel_vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Fuel prices history
CREATE TABLE public.sales_fuel_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_date DATE NOT NULL,
  price_per_litre NUMERIC NOT NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_fuel_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sfp_all" ON public.sales_fuel_prices FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE TRIGGER sfp_updated BEFORE UPDATE ON public.sales_fuel_prices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Payouts (declared before trips for FK)
CREATE TABLE public.sales_fuel_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_number TEXT UNIQUE,
  user_id UUID NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  total_km NUMERIC NOT NULL DEFAULT 0,
  total_litres NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Generated',
  generated_by UUID,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_by UUID,
  paid_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_fuel_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sfpay_all" ON public.sales_fuel_payouts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE TRIGGER sfpay_updated BEFORE UPDATE ON public.sales_fuel_payouts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trips
CREATE TABLE public.sales_fuel_trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_date DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id UUID NOT NULL,
  vehicle_id UUID REFERENCES public.sales_fuel_vehicles(id) ON DELETE SET NULL,
  from_location TEXT,
  to_location TEXT,
  purpose TEXT,
  start_odometer NUMERIC NOT NULL DEFAULT 0,
  end_odometer NUMERIC NOT NULL DEFAULT 0,
  km NUMERIC GENERATED ALWAYS AS (GREATEST(end_odometer - start_odometer, 0)) STORED,
  customer_id UUID,
  visit_id UUID,
  mileage_kmpl_snapshot NUMERIC,
  fuel_price_snapshot NUMERIC,
  litres NUMERIC,
  amount NUMERIC,
  status TEXT NOT NULL DEFAULT 'Submitted',
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  payout_id UUID REFERENCES public.sales_fuel_payouts(id) ON DELETE SET NULL,
  remarks TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.sales_fuel_trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sft_all" ON public.sales_fuel_trips FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE TRIGGER sft_updated BEFORE UPDATE ON public.sales_fuel_trips FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_sft_user_date ON public.sales_fuel_trips(user_id, trip_date);
CREATE INDEX idx_sft_status ON public.sales_fuel_trips(status);

-- Payout numbering trigger
CREATE OR REPLACE FUNCTION public.generate_sales_fuel_payout_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_year TEXT; v_max INTEGER;
BEGIN
  IF NEW.payout_number IS NOT NULL AND NEW.payout_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN payout_number LIKE 'FP-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(payout_number FROM 7), '')::INTEGER ELSE 0 END
  ), 0) + 1 INTO v_max
  FROM public.sales_fuel_payouts
  WHERE payout_number LIKE 'FP-' || v_year || '-%';
  NEW.payout_number := 'FP-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER sfpay_number BEFORE INSERT ON public.sales_fuel_payouts
FOR EACH ROW EXECUTE FUNCTION public.generate_sales_fuel_payout_number();

-- Snapshot mileage + fuel price + amount on approval
CREATE OR REPLACE FUNCTION public.sales_fuel_trip_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_mileage NUMERIC; v_price NUMERIC; v_km NUMERIC;
BEGIN
  IF NEW.status = 'Approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Approved') THEN
    -- Mileage snapshot from vehicle (or selected vehicle_id)
    IF NEW.mileage_kmpl_snapshot IS NULL OR NEW.mileage_kmpl_snapshot = 0 THEN
      SELECT mileage_kmpl INTO v_mileage FROM public.sales_fuel_vehicles
      WHERE (NEW.vehicle_id IS NOT NULL AND id = NEW.vehicle_id)
         OR (NEW.vehicle_id IS NULL AND user_id = NEW.user_id AND is_active = true)
      ORDER BY is_active DESC, updated_at DESC LIMIT 1;
      NEW.mileage_kmpl_snapshot := COALESCE(v_mileage, 0);
    END IF;
    -- Fuel price snapshot
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

CREATE TRIGGER sft_snapshot BEFORE INSERT OR UPDATE ON public.sales_fuel_trips
FOR EACH ROW EXECUTE FUNCTION public.sales_fuel_trip_snapshot();
