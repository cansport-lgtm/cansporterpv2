-- ============================================================
-- Accounting Module — Budget Management (Phase 1)
-- Budgets per chart-of-accounts head per month, compared client-side
-- against ledger actuals derived from accounting_voucher_lines.
-- Flexible start month so July–June fiscal years work natively.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  fiscal_year_label TEXT NOT NULL,
  start_year INT NOT NULL,
  start_month INT NOT NULL CHECK (start_month BETWEEN 1 AND 12),
  num_months INT NOT NULL DEFAULT 12 CHECK (num_months BETWEEN 1 AND 24),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'closed')),
  notes TEXT,
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.accounting_budget_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id UUID NOT NULL REFERENCES public.accounting_budgets(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounting_chart_of_accounts(id),
  period_year INT NOT NULL,
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (budget_id, account_id, period_year, period_month)
);

CREATE INDEX IF NOT EXISTS idx_accounting_budget_lines_budget
  ON public.accounting_budget_lines (budget_id);
CREATE INDEX IF NOT EXISTS idx_accounting_budget_lines_account_period
  ON public.accounting_budget_lines (account_id, period_year, period_month);

DROP TRIGGER IF EXISTS update_accounting_budgets_updated_at ON public.accounting_budgets;
CREATE TRIGGER update_accounting_budgets_updated_at
BEFORE UPDATE ON public.accounting_budgets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_accounting_budget_lines_updated_at ON public.accounting_budget_lines;
CREATE TRIGGER update_accounting_budget_lines_updated_at
BEFORE UPDATE ON public.accounting_budget_lines
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS permissive, matching the rest of the accounting schema (app uses custom auth)
ALTER TABLE public.accounting_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on accounting_budgets"
  ON public.accounting_budgets FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_budgets TO anon, authenticated, service_role;

ALTER TABLE public.accounting_budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on accounting_budget_lines"
  ON public.accounting_budget_lines FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_budget_lines TO anon, authenticated, service_role;
