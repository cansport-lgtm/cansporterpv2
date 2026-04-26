
-- Create employee_loans table
CREATE TABLE public.employee_loans (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES public.employees(id),
    loan_amount NUMERIC(12, 2) NOT NULL,
    interest_rate NUMERIC(5, 2) DEFAULT 0,
    loan_date DATE NOT NULL DEFAULT CURRENT_DATE,
    repayment_start_date DATE,
    monthly_installment NUMERIC(12, 2) NOT NULL,
    total_installments INTEGER NOT NULL,
    paid_installments INTEGER DEFAULT 0,
    remaining_amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'active', 'completed', 'rejected')),
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    purpose TEXT,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;

-- RLS policies for authenticated users
CREATE POLICY "Allow all operations for authenticated users" 
ON public.employee_loans 
FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);

-- Trigger for updated_at
CREATE TRIGGER update_employee_loans_updated_at
BEFORE UPDATE ON public.employee_loans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add comment
COMMENT ON TABLE public.employee_loans IS 'Employee loan tracking for HR module';
