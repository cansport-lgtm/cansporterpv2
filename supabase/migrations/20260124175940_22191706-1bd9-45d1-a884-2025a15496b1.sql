-- Create labour_advances table for tracking advance payments
CREATE TABLE public.labour_advances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.labour_employees(id) ON DELETE CASCADE,
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id)
);

-- Enable RLS
ALTER TABLE public.labour_advances ENABLE ROW LEVEL SECURITY;

-- Create policy for all operations (allow all for now since this is an internal ERP)
CREATE POLICY "Allow all operations on labour_advances" 
ON public.labour_advances 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Create index for faster lookups
CREATE INDEX idx_labour_advances_employee_id ON public.labour_advances(employee_id);
CREATE INDEX idx_labour_advances_date ON public.labour_advances(advance_date);