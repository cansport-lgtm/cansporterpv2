-- Expense Categories
CREATE TABLE public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  category_type VARCHAR(20) NOT NULL CHECK (category_type IN ('petty_cash', 'general', 'utility')),
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Utility Types
CREATE TABLE public.utility_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  billing_cycle VARCHAR(20) DEFAULT 'monthly',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Monthly Budgets
CREATE TABLE public.expense_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_year INT NOT NULL,
  budget_month INT NOT NULL CHECK (budget_month BETWEEN 1 AND 12),
  category_id UUID REFERENCES public.expense_categories(id),
  utility_type_id UUID REFERENCES public.utility_types(id),
  department_id UUID REFERENCES public.production_departments(id),
  budget_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(budget_year, budget_month, category_id, utility_type_id, department_id)
);

-- Petty Cash Fund
CREATE TABLE public.petty_cash_fund (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_date DATE NOT NULL DEFAULT CURRENT_DATE,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(12,2),
  total_receipts NUMERIC(12,2) DEFAULT 0,
  total_expenses NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_by UUID REFERENCES public.app_users(id),
  closed_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(fund_date)
);

-- Petty Cash Entries
CREATE TABLE public.petty_cash_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_number VARCHAR(30) NOT NULL UNIQUE,
  fund_id UUID REFERENCES public.petty_cash_fund(id),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type VARCHAR(20) NOT NULL CHECK (entry_type IN ('expense', 'receipt', 'replenishment')),
  category_id UUID REFERENCES public.expense_categories(id),
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  running_balance NUMERIC(12,2),
  paid_to VARCHAR(200),
  receipt_number VARCHAR(50),
  receipt_url TEXT,
  approval_status VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMPTZ,
  approval_remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- General Expenses
CREATE TABLE public.general_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_number VARCHAR(30) NOT NULL UNIQUE,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category_id UUID REFERENCES public.expense_categories(id),
  department_id UUID REFERENCES public.production_departments(id),
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  vendor_name VARCHAR(200),
  vendor_gstin VARCHAR(20),
  invoice_number VARCHAR(50),
  invoice_date DATE,
  payment_mode VARCHAR(20) CHECK (payment_mode IN ('cash', 'bank_transfer', 'cheque', 'upi', 'credit_card')),
  payment_reference VARCHAR(100),
  payment_date DATE,
  payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'partial')),
  attachment_url TEXT,
  approval_status VARCHAR(20) DEFAULT 'draft' CHECK (approval_status IN ('draft', 'pending', 'approved', 'rejected')),
  submitted_by UUID REFERENCES public.app_users(id),
  submitted_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMPTZ,
  approval_remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Utility Bills
CREATE TABLE public.utility_bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_number VARCHAR(30) NOT NULL UNIQUE,
  utility_type_id UUID REFERENCES public.utility_types(id) NOT NULL,
  department_id UUID REFERENCES public.production_departments(id),
  billing_period_start DATE NOT NULL,
  billing_period_end DATE NOT NULL,
  bill_date DATE NOT NULL,
  due_date DATE NOT NULL,
  meter_reading_previous NUMERIC(12,2),
  meter_reading_current NUMERIC(12,2),
  units_consumed NUMERIC(12,2),
  unit_rate NUMERIC(8,4),
  base_amount NUMERIC(12,2) NOT NULL,
  tax_amount NUMERIC(12,2) DEFAULT 0,
  other_charges NUMERIC(12,2) DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  payment_status VARCHAR(20) DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'overdue', 'partial')),
  payment_date DATE,
  payment_mode VARCHAR(20),
  payment_reference VARCHAR(100),
  bill_attachment_url TEXT,
  receipt_attachment_url TEXT,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Budget Alerts Log
CREATE TABLE public.budget_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type VARCHAR(20) NOT NULL CHECK (alert_type IN ('warning_80', 'exceeded_100')),
  budget_id UUID REFERENCES public.expense_budgets(id),
  budget_amount NUMERIC(12,2),
  actual_amount NUMERIC(12,2),
  percentage_used NUMERIC(5,2),
  alert_date DATE DEFAULT CURRENT_DATE,
  is_acknowledged BOOLEAN DEFAULT false,
  acknowledged_by UUID REFERENCES public.app_users(id),
  acknowledged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_fund ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petty_cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.general_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_alerts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (permissive for app_users system)
CREATE POLICY "Allow all for expense_categories" ON public.expense_categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for utility_types" ON public.utility_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for expense_budgets" ON public.expense_budgets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for petty_cash_fund" ON public.petty_cash_fund FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for petty_cash_entries" ON public.petty_cash_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for general_expenses" ON public.general_expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for utility_bills" ON public.utility_bills FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for budget_alerts" ON public.budget_alerts FOR ALL USING (true) WITH CHECK (true);

-- Sequences for auto-numbering
CREATE SEQUENCE IF NOT EXISTS petty_cash_entry_seq START 1;
CREATE SEQUENCE IF NOT EXISTS general_expense_seq START 1;
CREATE SEQUENCE IF NOT EXISTS utility_bill_seq START 1;

-- Auto-generate entry numbers
CREATE OR REPLACE FUNCTION public.generate_petty_cash_entry_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.entry_number := 'PC-' || TO_CHAR(NEW.entry_date, 'YYYYMM') || '-' || LPAD(nextval('petty_cash_entry_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.generate_general_expense_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.expense_number := 'EXP-' || TO_CHAR(NEW.expense_date, 'YYYYMM') || '-' || LPAD(nextval('general_expense_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.generate_utility_bill_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.bill_number := 'UTL-' || TO_CHAR(NEW.bill_date, 'YYYYMM') || '-' || LPAD(nextval('utility_bill_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_petty_cash_entry_number
  BEFORE INSERT ON public.petty_cash_entries
  FOR EACH ROW EXECUTE FUNCTION public.generate_petty_cash_entry_number();

CREATE TRIGGER set_general_expense_number
  BEFORE INSERT ON public.general_expenses
  FOR EACH ROW EXECUTE FUNCTION public.generate_general_expense_number();

CREATE TRIGGER set_utility_bill_number
  BEFORE INSERT ON public.utility_bills
  FOR EACH ROW EXECUTE FUNCTION public.generate_utility_bill_number();

-- Storage bucket for expense attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('expense-attachments', 'expense-attachments', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Allow public read expense-attachments" ON storage.objects FOR SELECT USING (bucket_id = 'expense-attachments');
CREATE POLICY "Allow insert expense-attachments" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'expense-attachments');
CREATE POLICY "Allow update expense-attachments" ON storage.objects FOR UPDATE USING (bucket_id = 'expense-attachments');
CREATE POLICY "Allow delete expense-attachments" ON storage.objects FOR DELETE USING (bucket_id = 'expense-attachments');

-- Insert default expense categories
INSERT INTO public.expense_categories (code, name, category_type) VALUES
('PC-OFFICE', 'Office Supplies', 'petty_cash'),
('PC-TRAVEL', 'Local Travel', 'petty_cash'),
('PC-FOOD', 'Tea/Refreshments', 'petty_cash'),
('PC-COURIER', 'Courier/Postage', 'petty_cash'),
('PC-MISC', 'Miscellaneous', 'petty_cash'),
('GE-MAINT', 'Maintenance & Repairs', 'general'),
('GE-RENT', 'Rent & Lease', 'general'),
('GE-INSUR', 'Insurance', 'general'),
('GE-LEGAL', 'Legal & Professional', 'general'),
('GE-MKTG', 'Marketing & Advertising', 'general'),
('GE-IT', 'IT & Software', 'general'),
('GE-TRANS', 'Transportation', 'general'),
('GE-MISC', 'Other Expenses', 'general');

-- Insert default utility types
INSERT INTO public.utility_types (code, name) VALUES
('ELEC', 'Electricity'),
('GAS', 'Gas'),
('WATER', 'Water'),
('INTERNET', 'Internet/Telecom'),
('FUEL', 'Fuel/Diesel');