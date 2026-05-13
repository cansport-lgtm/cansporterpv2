-- ============================================================
-- Accounting Module — Phase 2B: Purchase Integration
-- Adds: party bridge on suppliers, AP + category default-account slots
-- ============================================================

-- 1) Bridge suppliers <-> accounting_parties
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS accounting_party_id UUID REFERENCES public.accounting_parties(id);
CREATE INDEX IF NOT EXISTS idx_suppliers_accounting_party ON public.suppliers(accounting_party_id);

-- 2) Seed default-account slots
-- purchase_orders.category drives which Dr account a GRN posts to.
INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'accounts_payable', id, 'Default AP control account, credited on GRN'
  FROM public.accounting_chart_of_accounts WHERE code = '2101'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'purchase_account_raw_material', id, 'Dr account for raw_material category purchases'
  FROM public.accounting_chart_of_accounts WHERE code = '1130'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'purchase_account_office_supplies', id, 'Dr account for office_supplies category purchases'
  FROM public.accounting_chart_of_accounts WHERE code = '5208'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'purchase_account_general_supplies', id, 'Dr account for general_supplies category purchases'
  FROM public.accounting_chart_of_accounts WHERE code = '5216'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'purchase_account_spare_maintenance', id, 'Dr account for spare_maintenance category purchases'
  FROM public.accounting_chart_of_accounts WHERE code = '5210'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'purchase_returns', id, 'Default account credited when goods are returned to supplier'
  FROM public.accounting_chart_of_accounts WHERE code = '4010'  -- temporarily uses Sales Returns; user should re-map
ON CONFLICT (key) DO NOTHING;
