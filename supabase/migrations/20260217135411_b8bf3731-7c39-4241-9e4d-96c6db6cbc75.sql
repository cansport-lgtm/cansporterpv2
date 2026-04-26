
CREATE TABLE public.labour_attendance_allowances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.labour_employees(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  allowance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id)
);

ALTER TABLE public.labour_attendance_allowances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to attendance allowances" ON public.labour_attendance_allowances FOR ALL USING (true) WITH CHECK (true);
