CREATE TABLE public.machine_monitor_breakdowns (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  machine_id UUID NOT NULL REFERENCES public.machine_monitor_machines(id) ON DELETE CASCADE,
  breakdown_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  breakdown_started_by UUID REFERENCES public.app_users(id),
  breakdown_remarks TEXT,
  breakdown_ended_at TIMESTAMPTZ,
  breakdown_ended_by UUID REFERENCES public.app_users(id),
  recovery_remarks TEXT,
  recovered_to_status TEXT,
  downtime_minutes INTEGER,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_mmb_machine ON public.machine_monitor_breakdowns(machine_id);
CREATE INDEX idx_mmb_status ON public.machine_monitor_breakdowns(status);
CREATE INDEX idx_mmb_started ON public.machine_monitor_breakdowns(breakdown_started_at DESC);

ALTER TABLE public.machine_monitor_breakdowns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to machine_monitor_breakdowns"
ON public.machine_monitor_breakdowns
TO anon
USING (true) WITH CHECK (true);

CREATE TRIGGER update_mmb_updated_at
BEFORE UPDATE ON public.machine_monitor_breakdowns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();