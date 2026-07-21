-- Scheduled cash items for the Cash Flow Forecast: user-defined recurring
-- (monthly) or one-time cash events that are forecast on their due date
-- instead of the 90-day run-rate — utility bills, rent receipts, credit-card
-- bills (owner drawings), etc.
--
-- account_id (optional): the chart-of-accounts head this item posts through.
-- When set, that account's vouchers are EXCLUDED from the forecast's run-rate
-- so the same cash isn't counted both as run-rate and as a scheduled item.
CREATE TABLE public.accounting_scheduled_cash_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('inflow', 'outflow')),
  category VARCHAR(20) NOT NULL DEFAULT 'bill' CHECK (category IN ('bill', 'rent', 'drawings', 'other')),
  amount NUMERIC(15,2) NOT NULL CHECK (amount >= 0),
  frequency VARCHAR(10) NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('monthly', 'one_time')),
  -- monthly items: day of month the payment/receipt falls due (clamped to
  -- month length at forecast time). one_time items: the specific date.
  due_day INTEGER CHECK (due_day BETWEEN 1 AND 31),
  due_date DATE,
  account_id UUID REFERENCES public.accounting_chart_of_accounts(id),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (frequency = 'monthly' AND due_day IS NOT NULL) OR
    (frequency = 'one_time' AND due_date IS NOT NULL)
  )
);

ALTER TABLE public.accounting_scheduled_cash_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on accounting_scheduled_cash_items" ON public.accounting_scheduled_cash_items FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_accounting_scheduled_cash_items_updated_at
  BEFORE UPDATE ON public.accounting_scheduled_cash_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
