CREATE TABLE public.mph_calculating_numbers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES production_departments(id) ON DELETE CASCADE,
  sub_department_id UUID REFERENCES production_sub_departments(id) ON DELETE SET NULL,
  mph_number NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(department_id, sub_department_id)
);

ALTER TABLE public.mph_calculating_numbers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Full access for authenticated" ON public.mph_calculating_numbers FOR ALL TO authenticated USING (true) WITH CHECK (true);