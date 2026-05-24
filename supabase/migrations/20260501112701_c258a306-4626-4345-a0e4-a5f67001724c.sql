-- Hourly loss reasons master with per-process applicability
CREATE TABLE public.hourly_loss_reasons (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code varchar(20) NOT NULL UNIQUE,
  name varchar(255) NOT NULL,
  category varchar(100),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.hourly_loss_reasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access" ON public.hourly_loss_reasons TO anon
  USING (true) WITH CHECK (true);

CREATE TABLE public.hourly_loss_reason_processes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reason_id uuid NOT NULL REFERENCES public.hourly_loss_reasons(id) ON DELETE CASCADE,
  process_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reason_id, process_name)
);

ALTER TABLE public.hourly_loss_reason_processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access" ON public.hourly_loss_reason_processes TO anon
  USING (true) WITH CHECK (true);

CREATE INDEX idx_hlrp_reason ON public.hourly_loss_reason_processes(reason_id);
CREATE INDEX idx_hlrp_process ON public.hourly_loss_reason_processes(process_name);

-- Add new FK column to losses table (keep old reason_id for backward compat)
ALTER TABLE public.hourly_production_losses
  ADD COLUMN loss_reason_id uuid REFERENCES public.hourly_loss_reasons(id) ON DELETE SET NULL;

CREATE INDEX idx_hpl_loss_reason ON public.hourly_production_losses(loss_reason_id);