
CREATE TABLE public.labour_travel_advances (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.labour_employees(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL DEFAULT 0,
  advance_date DATE NOT NULL DEFAULT CURRENT_DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id)
);

ALTER TABLE public.labour_travel_advances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to labour_travel_advances" ON public.labour_travel_advances FOR ALL USING (true) WITH CHECK (true);
