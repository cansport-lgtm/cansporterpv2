-- ============================================================
-- Accounting Module — Phase 1 (Standalone)
-- Demo build: CRV flow end-to-end
-- ============================================================

-- Enums
CREATE TYPE public.accounting_account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');
CREATE TYPE public.accounting_voucher_type AS ENUM ('CRV', 'CPV', 'BRV', 'BPV', 'JV', 'CV', 'OB');
CREATE TYPE public.accounting_party_type AS ENUM ('customer', 'supplier', 'employee', 'other');

-- Chart of Accounts
CREATE TABLE public.accounting_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  account_type accounting_account_type NOT NULL,
  sub_category VARCHAR(100),
  parent_id UUID REFERENCES public.accounting_chart_of_accounts(id),
  is_cash_account BOOLEAN DEFAULT false,
  is_bank_account BOOLEAN DEFAULT false,
  is_control_account BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Parties (customers, suppliers, employees, other)
CREATE TABLE public.accounting_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) UNIQUE,
  name VARCHAR(200) NOT NULL,
  party_type accounting_party_type NOT NULL,
  contact_person VARCHAR(100),
  phone VARCHAR(30),
  email VARCHAR(100),
  address TEXT,
  ntn VARCHAR(30),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Vouchers (header)
CREATE TABLE public.accounting_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number VARCHAR(30) NOT NULL UNIQUE,
  voucher_type accounting_voucher_type NOT NULL,
  voucher_date DATE NOT NULL DEFAULT CURRENT_DATE,
  party_id UUID REFERENCES public.accounting_parties(id),
  narration TEXT,
  total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  source_module VARCHAR(50) DEFAULT 'manual',
  source_reference_id UUID,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Voucher Lines
CREATE TABLE public.accounting_voucher_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id UUID NOT NULL REFERENCES public.accounting_vouchers(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounting_chart_of_accounts(id),
  party_id UUID REFERENCES public.accounting_parties(id),
  debit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  line_narration TEXT,
  line_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_accounting_voucher_lines_voucher ON public.accounting_voucher_lines(voucher_id);
CREATE INDEX idx_accounting_voucher_lines_account ON public.accounting_voucher_lines(account_id);
CREATE INDEX idx_accounting_voucher_lines_party ON public.accounting_voucher_lines(party_id);
CREATE INDEX idx_accounting_vouchers_date ON public.accounting_vouchers(voucher_date);
CREATE INDEX idx_accounting_vouchers_type ON public.accounting_vouchers(voucher_type);

-- RLS (permissive — matches existing finance pattern, app uses custom auth)
ALTER TABLE public.accounting_chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_voucher_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on accounting_chart_of_accounts" ON public.accounting_chart_of_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on accounting_parties" ON public.accounting_parties FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on accounting_vouchers" ON public.accounting_vouchers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on accounting_voucher_lines" ON public.accounting_voucher_lines FOR ALL USING (true) WITH CHECK (true);

-- Grant role-level access (Supabase requires both GRANT + RLS policy to allow anon/authenticated access)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_chart_of_accounts TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_parties TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_vouchers TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accounting_voucher_lines TO anon, authenticated, service_role;

-- updated_at triggers
CREATE TRIGGER update_accounting_coa_updated_at BEFORE UPDATE ON public.accounting_chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_accounting_parties_updated_at BEFORE UPDATE ON public.accounting_parties FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_accounting_vouchers_updated_at BEFORE UPDATE ON public.accounting_vouchers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Voucher number generator: {TYPE}-{YYYYMM}-{NNNN}
CREATE OR REPLACE FUNCTION public.generate_accounting_voucher_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  prefix TEXT;
  counter INT;
BEGIN
  IF NEW.voucher_number IS NULL OR NEW.voucher_number = '' THEN
    prefix := NEW.voucher_type::TEXT || '-' || TO_CHAR(NEW.voucher_date, 'YYYYMM');
    SELECT COALESCE(MAX(CAST(SUBSTRING(voucher_number FROM '\d+$') AS INTEGER)), 0) + 1
      INTO counter
      FROM public.accounting_vouchers
      WHERE voucher_number LIKE prefix || '-%';
    NEW.voucher_number := prefix || '-' || LPAD(counter::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER generate_accounting_voucher_number_trg
BEFORE INSERT ON public.accounting_vouchers
FOR EACH ROW EXECUTE FUNCTION public.generate_accounting_voucher_number();

-- ============================================================
-- Seed: Default Pakistani-style Chart of Accounts
-- ============================================================

INSERT INTO public.accounting_chart_of_accounts (code, name, account_type, sub_category, is_cash_account, is_bank_account, is_control_account, sort_order) VALUES
-- ASSETS
('1000', 'ASSETS', 'asset', NULL, false, false, false, 1),
('1100', 'Current Assets', 'asset', 'Current Assets', false, false, false, 10),
('1101', 'Cash in Hand', 'asset', 'Cash', true, false, false, 11),
('1102', 'Petty Cash', 'asset', 'Cash', true, false, false, 12),
('1110', 'Bank - HBL Current Account', 'asset', 'Bank', false, true, false, 13),
('1111', 'Bank - MCB Current Account', 'asset', 'Bank', false, true, false, 14),
('1112', 'Bank - Meezan Current Account', 'asset', 'Bank', false, true, false, 15),
('1120', 'Accounts Receivable', 'asset', 'Receivables', false, false, true, 20),
('1130', 'Inventory - Raw Material', 'asset', 'Inventory', false, false, false, 30),
('1131', 'Inventory - Work in Progress', 'asset', 'Inventory', false, false, false, 31),
('1132', 'Inventory - Finished Goods', 'asset', 'Inventory', false, false, false, 32),
('1140', 'Advances to Suppliers', 'asset', 'Advances', false, false, false, 40),
('1150', 'Prepaid Expenses', 'asset', 'Prepaid', false, false, false, 50),
('1200', 'Fixed Assets', 'asset', 'Fixed Assets', false, false, false, 100),
('1201', 'Plant & Machinery', 'asset', 'Fixed Assets', false, false, false, 101),
('1202', 'Furniture & Fixtures', 'asset', 'Fixed Assets', false, false, false, 102),
('1203', 'Vehicles', 'asset', 'Fixed Assets', false, false, false, 103),
('1204', 'Computers & IT Equipment', 'asset', 'Fixed Assets', false, false, false, 104),
('1210', 'Accumulated Depreciation', 'asset', 'Fixed Assets', false, false, false, 110),

-- LIABILITIES
('2000', 'LIABILITIES', 'liability', NULL, false, false, false, 200),
('2100', 'Current Liabilities', 'liability', 'Current Liabilities', false, false, false, 210),
('2101', 'Accounts Payable', 'liability', 'Payables', false, false, true, 211),
('2102', 'Wages Payable', 'liability', 'Payables', false, false, false, 212),
('2103', 'Utilities Payable', 'liability', 'Payables', false, false, false, 213),
('2104', 'Sales Tax Payable', 'liability', 'Tax Payables', false, false, false, 214),
('2105', 'Withholding Tax Payable', 'liability', 'Tax Payables', false, false, false, 215),
('2106', 'Income Tax Payable', 'liability', 'Tax Payables', false, false, false, 216),
('2110', 'Advances from Customers', 'liability', 'Customer Advances', false, false, false, 220),
('2200', 'Long-term Liabilities', 'liability', 'Long-term', false, false, false, 300),
('2201', 'Bank Loan', 'liability', 'Long-term', false, false, false, 301),

-- EQUITY
('3000', 'EQUITY', 'equity', NULL, false, false, false, 400),
('3001', 'Capital', 'equity', 'Owner Equity', false, false, false, 401),
('3002', 'Owner Drawings', 'equity', 'Owner Equity', false, false, false, 402),
('3010', 'Retained Earnings', 'equity', 'Retained Earnings', false, false, false, 410),
('3020', 'Current Year Earnings', 'equity', 'Retained Earnings', false, false, false, 411),

-- REVENUE
('4000', 'REVENUE', 'revenue', NULL, false, false, false, 500),
('4001', 'Sales - Domestic', 'revenue', 'Sales', false, false, false, 501),
('4002', 'Sales - Export', 'revenue', 'Sales', false, false, false, 502),
('4003', 'Sales - Online', 'revenue', 'Sales', false, false, false, 503),
('4010', 'Sales Returns', 'revenue', 'Sales Returns', false, false, false, 510),
('4020', 'Other Income', 'revenue', 'Other Income', false, false, false, 520),
('4030', 'Interest Income', 'revenue', 'Other Income', false, false, false, 521),

-- EXPENSES
('5000', 'EXPENSES', 'expense', NULL, false, false, false, 600),
('5100', 'Cost of Goods Sold', 'expense', 'COGS', false, false, false, 601),
('5101', 'Raw Material Consumed', 'expense', 'COGS', false, false, false, 602),
('5102', 'Direct Labour', 'expense', 'COGS', false, false, false, 603),
('5103', 'Factory Overheads', 'expense', 'COGS', false, false, false, 604),
('5200', 'Operating Expenses', 'expense', 'Operating', false, false, false, 700),
('5201', 'Salaries - Staff', 'expense', 'Salaries', false, false, false, 701),
('5202', 'Salaries - Workers', 'expense', 'Salaries', false, false, false, 702),
('5203', 'Rent', 'expense', 'Operating', false, false, false, 703),
('5204', 'Electricity', 'expense', 'Utilities', false, false, false, 704),
('5205', 'Gas', 'expense', 'Utilities', false, false, false, 705),
('5206', 'Water', 'expense', 'Utilities', false, false, false, 706),
('5207', 'Internet & Telephone', 'expense', 'Utilities', false, false, false, 707),
('5208', 'Office Supplies', 'expense', 'Operating', false, false, false, 708),
('5209', 'Fuel & Travel', 'expense', 'Operating', false, false, false, 709),
('5210', 'Repair & Maintenance', 'expense', 'Operating', false, false, false, 710),
('5211', 'Marketing & Advertising', 'expense', 'Operating', false, false, false, 711),
('5212', 'Professional Fees', 'expense', 'Operating', false, false, false, 712),
('5213', 'Depreciation Expense', 'expense', 'Depreciation', false, false, false, 713),
('5214', 'Bank Charges', 'expense', 'Financial', false, false, false, 714),
('5215', 'Insurance', 'expense', 'Operating', false, false, false, 715),
('5216', 'Miscellaneous Expense', 'expense', 'Operating', false, false, false, 716);
