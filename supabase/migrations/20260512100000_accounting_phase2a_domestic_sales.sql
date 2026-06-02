-- ============================================================
-- Accounting Module — Phase 2A: Domestic Sales Integration
-- Adds: party bridge on customers, default-accounts config
-- ============================================================

-- 1) Bridge customers <-> accounting_parties
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS accounting_party_id UUID REFERENCES public.accounting_parties(id);

CREATE INDEX IF NOT EXISTS idx_customers_accounting_party ON public.customers(accounting_party_id);

-- 2) Default-account mappings
-- One row per "named slot" the accounting module uses when auto-posting.
-- Keys are stable strings the application code knows; account_id points at any CoA row.
CREATE TABLE IF NOT EXISTS public.accounting_default_accounts (
  key VARCHAR(60) PRIMARY KEY,
  account_id UUID REFERENCES public.accounting_chart_of_accounts(id),
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES public.app_users(id)
);

ALTER TABLE public.accounting_default_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on accounting_default_accounts"
  ON public.accounting_default_accounts FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_accounting_default_accounts_updated_at
BEFORE UPDATE ON public.accounting_default_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) Seed defaults pointing at the seeded Phase-1 CoA codes
-- Sales Revenue (Domestic) = 4001
-- Accounts Receivable      = 1120
-- Sales Returns            = 4010
-- Sales Tax Payable        = 2104 (kept for future tax phase even though Phase 1 = no tax)
-- Default Cash             = 1101
-- Default Bank             = 1110
INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'sales_revenue_domestic', id, 'Default Sales Revenue account for domestic sales auto-postings'
  FROM public.accounting_chart_of_accounts WHERE code = '4001'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'accounts_receivable', id, 'Default Accounts Receivable control account'
  FROM public.accounting_chart_of_accounts WHERE code = '1120'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'sales_returns', id, 'Default Sales Returns account'
  FROM public.accounting_chart_of_accounts WHERE code = '4010'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'default_cash', id, 'Default Cash in Hand account for receipts'
  FROM public.accounting_chart_of_accounts WHERE code = '1101'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'default_bank', id, 'Default Bank account for bank receipts'
  FROM public.accounting_chart_of_accounts WHERE code = '1110'
ON CONFLICT (key) DO NOTHING;

-- 4) Indexes on the source-tracking columns of accounting_vouchers (defensive)
-- These enable the idempotency lookup in postDispatchVoucher to be fast.
CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_source
  ON public.accounting_vouchers(source_module, source_reference_id);
