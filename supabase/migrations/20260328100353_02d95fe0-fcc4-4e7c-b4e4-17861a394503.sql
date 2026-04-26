
-- HR Advances table for salary deductions
CREATE TABLE public.hr_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL DEFAULT 0,
  remarks TEXT,
  is_deducted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id)
);

ALTER TABLE public.hr_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated access to hr_advances"
  ON public.hr_advances FOR ALL TO authenticated USING (true) WITH CHECK (true);
