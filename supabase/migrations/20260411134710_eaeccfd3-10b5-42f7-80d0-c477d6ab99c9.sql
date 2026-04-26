
CREATE TABLE public.performance_daily_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kpi_id UUID NOT NULL REFERENCES public.performance_monthly_kpis(id) ON DELETE CASCADE,
  tracking_date DATE NOT NULL,
  actual_value NUMERIC,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(employee_id, kpi_id, tracking_date)
);

ALTER TABLE public.performance_daily_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow full access to anon" ON public.performance_daily_tracking
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TRIGGER update_performance_daily_tracking_updated_at
  BEFORE UPDATE ON public.performance_daily_tracking
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
