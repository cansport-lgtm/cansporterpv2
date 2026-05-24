CREATE TABLE public.crm_marketing_kpi_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL,
  kpi_key TEXT NOT NULL,
  target_value NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month, kpi_key)
);

ALTER TABLE public.crm_marketing_kpi_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to crm_marketing_kpi_targets"
  ON public.crm_marketing_kpi_targets
  FOR ALL TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE TRIGGER trg_crm_marketing_kpi_targets_updated_at
  BEFORE UPDATE ON public.crm_marketing_kpi_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();