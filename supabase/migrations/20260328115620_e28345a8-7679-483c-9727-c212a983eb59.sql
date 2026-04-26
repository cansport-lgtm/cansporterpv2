
CREATE TABLE public.salary_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_month INTEGER NOT NULL,
  lock_year INTEGER NOT NULL,
  locked_by UUID REFERENCES public.app_users(id),
  locked_at TIMESTAMPTZ DEFAULT now(),
  total_net_salary NUMERIC DEFAULT 0,
  total_employees INTEGER DEFAULT 0,
  remarks TEXT,
  UNIQUE(lock_month, lock_year)
);

ALTER TABLE public.salary_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to salary_locks" ON public.salary_locks FOR ALL USING (true) WITH CHECK (true);
