
-- Account type enum
CREATE TYPE public.finance_account_type AS ENUM ('asset', 'liability', 'equity', 'revenue', 'expense');

-- Period status enum
CREATE TYPE public.finance_period_status AS ENUM ('open', 'closed', 'draft');

-- Chart of Accounts
CREATE TABLE public.finance_chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  account_type finance_account_type NOT NULL,
  sub_category VARCHAR(100),
  parent_id UUID REFERENCES public.finance_chart_of_accounts(id),
  is_cash_account BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Periods (monthly)
CREATE TABLE public.finance_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_name VARCHAR(50) NOT NULL,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status finance_period_status DEFAULT 'draft',
  is_closed BOOLEAN DEFAULT false,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(year, month)
);

-- Trial Balance Entries
CREATE TABLE public.finance_trial_balance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.finance_periods(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.finance_chart_of_accounts(id),
  debit_amount NUMERIC(15,2) DEFAULT 0,
  credit_amount NUMERIC(15,2) DEFAULT 0,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_id, account_id)
);

-- Journal Entries (adjustments)
CREATE TABLE public.finance_journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id UUID NOT NULL REFERENCES public.finance_periods(id),
  entry_number VARCHAR(30) NOT NULL UNIQUE,
  description TEXT,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) DEFAULT 'draft',
  total_debit NUMERIC(15,2) DEFAULT 0,
  total_credit NUMERIC(15,2) DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Journal Entry Lines
CREATE TABLE public.finance_journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.finance_journal_entries(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.finance_chart_of_accounts(id),
  debit_amount NUMERIC(15,2) DEFAULT 0,
  credit_amount NUMERIC(15,2) DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.finance_chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_trial_balance_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_journal_entry_lines ENABLE ROW LEVEL SECURITY;

-- Permissive policies (custom auth system)
CREATE POLICY "Allow all on finance_chart_of_accounts" ON public.finance_chart_of_accounts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on finance_periods" ON public.finance_periods FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on finance_trial_balance_entries" ON public.finance_trial_balance_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on finance_journal_entries" ON public.finance_journal_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on finance_journal_entry_lines" ON public.finance_journal_entry_lines FOR ALL USING (true) WITH CHECK (true);

-- Updated_at triggers
CREATE TRIGGER update_finance_coa_updated_at BEFORE UPDATE ON public.finance_chart_of_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_finance_periods_updated_at BEFORE UPDATE ON public.finance_periods FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_finance_tb_updated_at BEFORE UPDATE ON public.finance_trial_balance_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_finance_je_updated_at BEFORE UPDATE ON public.finance_journal_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Journal entry number generator
CREATE OR REPLACE FUNCTION public.generate_journal_entry_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.entry_number IS NULL OR NEW.entry_number = '' THEN
    NEW.entry_number := 'JE-' || TO_CHAR(NEW.entry_date, 'YYYYMM') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER generate_je_number BEFORE INSERT ON public.finance_journal_entries FOR EACH ROW EXECUTE FUNCTION public.generate_journal_entry_number();
