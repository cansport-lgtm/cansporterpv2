CREATE TABLE public.labour_salary_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_id uuid NOT NULL REFERENCES public.salary_locks(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL,
  employee_code text NOT NULL,
  full_name text NOT NULL,
  category text,
  department_name text,
  employee_type text NOT NULL,
  monthly_salary numeric DEFAULT 0,
  per_day_wages numeric DEFAULT 0,
  full_days numeric DEFAULT 0,
  half_days numeric DEFAULT 0,
  paid_sundays numeric DEFAULT 0,
  absent_days numeric DEFAULT 0,
  total_mph numeric DEFAULT 0,
  gross_salary numeric DEFAULT 0,
  total_overtime numeric DEFAULT 0,
  total_advance numeric DEFAULT 0,
  total_travel_advance numeric DEFAULT 0,
  total_att_allowance numeric DEFAULT 0,
  earned_salary numeric DEFAULT 0,
  days_worked numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.labour_salary_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to labour_salary_snapshots" ON public.labour_salary_snapshots FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_labour_salary_snapshots_lock_id ON public.labour_salary_snapshots(lock_id);