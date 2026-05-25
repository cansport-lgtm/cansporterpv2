CREATE TABLE IF NOT EXISTS public.machine_monitor_performance_issues (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  machine_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_by UUID,
  start_reason TEXT,
  start_remarks TEXT,
  ended_at TIMESTAMPTZ,
  ended_by UUID,
  recovery_remarks TEXT,
  recovered_to_status TEXT,
  duration_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mmpi_machine ON public.machine_monitor_performance_issues(machine_id);
CREATE INDEX IF NOT EXISTS idx_mmpi_status ON public.machine_monitor_performance_issues(status);
CREATE INDEX IF NOT EXISTS idx_mmpi_started ON public.machine_monitor_performance_issues(started_at DESC);

ALTER TABLE public.machine_monitor_performance_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mmpi_select_all" ON public.machine_monitor_performance_issues FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "mmpi_insert_all" ON public.machine_monitor_performance_issues FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "mmpi_update_all" ON public.machine_monitor_performance_issues FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "mmpi_delete_all" ON public.machine_monitor_performance_issues FOR DELETE TO anon, authenticated USING (true);

CREATE TRIGGER update_mmpi_updated_at
  BEFORE UPDATE ON public.machine_monitor_performance_issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();