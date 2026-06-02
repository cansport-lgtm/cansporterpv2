CREATE TABLE public.hourly_production_daily_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL,
  process_id uuid NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
  target_per_hour numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entry_date, process_id)
);

ALTER TABLE public.hourly_production_daily_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to hourly_production_daily_targets"
ON public.hourly_production_daily_targets
TO anon
USING (true) WITH CHECK (true);

CREATE TRIGGER update_hourly_production_daily_targets_updated_at
BEFORE UPDATE ON public.hourly_production_daily_targets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_hpdt_date ON public.hourly_production_daily_targets(entry_date);
CREATE INDEX idx_hpdt_process ON public.hourly_production_daily_targets(process_id);