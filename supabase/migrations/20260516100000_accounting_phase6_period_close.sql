-- ============================================================
-- Accounting Module — Phase 6: Period close
-- Adds a single-row config table for the "closed-through" date,
-- plus a BEFORE INSERT trigger that blocks vouchers ≤ that date.
-- Year-end closing JV is generated client-side (no schema needed).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_period_close (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce single row
  closed_through_date DATE,
  last_closed_at TIMESTAMPTZ,
  last_closed_by UUID REFERENCES public.app_users(id),
  notes TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed the single row (idempotent)
INSERT INTO public.accounting_period_close (id, closed_through_date) VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.accounting_period_close ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on accounting_period_close"
  ON public.accounting_period_close FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_period_close TO anon, authenticated, service_role;

-- Guard trigger: block new voucher inserts dated ≤ the closed-through date
CREATE OR REPLACE FUNCTION public.enforce_accounting_period_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  closed_date DATE;
BEGIN
  SELECT closed_through_date INTO closed_date FROM public.accounting_period_close WHERE id = 1;
  IF closed_date IS NOT NULL AND NEW.voucher_date <= closed_date THEN
    RAISE EXCEPTION 'Period is closed through %. Cannot post vouchers dated on or before that date.', closed_date
      USING HINT = 'Reopen the period in /accounting/period-close or use a date after the closed-through date.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_accounting_period_close_trg ON public.accounting_vouchers;
CREATE TRIGGER enforce_accounting_period_close_trg
BEFORE INSERT ON public.accounting_vouchers
FOR EACH ROW EXECUTE FUNCTION public.enforce_accounting_period_close();
