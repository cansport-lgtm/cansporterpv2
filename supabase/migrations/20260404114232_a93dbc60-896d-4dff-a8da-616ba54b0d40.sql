
-- 1. Add annual_leaves column to employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS annual_leaves INTEGER DEFAULT 18;

-- 2. Create employee_leave_balances table
CREATE TABLE public.employee_leave_balances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  total_allocated INTEGER NOT NULL DEFAULT 18,
  total_used NUMERIC(5,1) NOT NULL DEFAULT 0,
  remaining NUMERIC(5,1) NOT NULL DEFAULT 18,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(employee_id, year)
);

ALTER TABLE public.employee_leave_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.employee_leave_balances FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_employee_leave_balances_updated_at
  BEFORE UPDATE ON public.employee_leave_balances
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Create hr_overtime table
CREATE TABLE public.hr_overtime (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  overtime_date DATE NOT NULL,
  hours NUMERIC(5,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.hr_overtime ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.hr_overtime FOR ALL USING (true) WITH CHECK (true);

-- 4. Create loan_payment_history table for tracking auto-deductions
CREATE TABLE public.loan_payment_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id UUID NOT NULL REFERENCES public.employee_loans(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  payment_month INTEGER NOT NULL,
  payment_year INTEGER NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(loan_id, payment_month, payment_year)
);

ALTER TABLE public.loan_payment_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all for authenticated" ON public.loan_payment_history FOR ALL USING (true) WITH CHECK (true);
