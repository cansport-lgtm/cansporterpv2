
-- Monthly KPIs master table (separate from goal-based KPIs)
CREATE TABLE public.performance_monthly_kpis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general',
  weight NUMERIC NOT NULL DEFAULT 1,
  max_score NUMERIC NOT NULL DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Monthly score entries per employee per KPI
CREATE TABLE public.performance_monthly_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kpi_id UUID NOT NULL REFERENCES public.performance_monthly_kpis(id) ON DELETE CASCADE,
  score_month INTEGER NOT NULL CHECK (score_month BETWEEN 1 AND 12),
  score_year INTEGER NOT NULL,
  target_value NUMERIC NOT NULL DEFAULT 0,
  actual_value NUMERIC DEFAULT 0,
  score NUMERIC DEFAULT 0,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(employee_id, kpi_id, score_month, score_year)
);

-- Enable RLS
ALTER TABLE public.performance_monthly_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_monthly_scores ENABLE ROW LEVEL SECURITY;

-- RLS policies (allow all for authenticated - uses app-level auth)
CREATE POLICY "Allow all for performance_monthly_kpis" ON public.performance_monthly_kpis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for performance_monthly_scores" ON public.performance_monthly_scores FOR ALL USING (true) WITH CHECK (true);

-- Updated_at triggers
CREATE TRIGGER update_performance_monthly_kpis_updated_at BEFORE UPDATE ON public.performance_monthly_kpis FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_performance_monthly_scores_updated_at BEFORE UPDATE ON public.performance_monthly_scores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
