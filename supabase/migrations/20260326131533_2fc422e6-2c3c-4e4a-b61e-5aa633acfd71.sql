
-- Monthly goal assignments: assign specific KPIs to employees per month with review workflow
CREATE TABLE public.performance_monthly_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kpi_id UUID NOT NULL REFERENCES public.performance_monthly_kpis(id) ON DELETE CASCADE,
  goal_month INTEGER NOT NULL CHECK (goal_month BETWEEN 1 AND 12),
  goal_year INTEGER NOT NULL,
  target_value NUMERIC NOT NULL DEFAULT 0,
  actual_value NUMERIC DEFAULT NULL,
  score NUMERIC DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'closed')),
  assigned_by TEXT DEFAULT NULL,
  reviewed_by TEXT DEFAULT NULL,
  reviewed_at TIMESTAMPTZ DEFAULT NULL,
  approved_by TEXT DEFAULT NULL,
  approved_at TIMESTAMPTZ DEFAULT NULL,
  remarks TEXT DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, kpi_id, goal_month, goal_year)
);

ALTER TABLE public.performance_monthly_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to performance_monthly_goals" ON public.performance_monthly_goals FOR ALL USING (true) WITH CHECK (true);
