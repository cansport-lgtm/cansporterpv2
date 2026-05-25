CREATE TABLE public.crm_reactivations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL UNIQUE REFERENCES public.customers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  assigned_to UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  notes TEXT,
  converted_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  reactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_reactivation_attempts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reactivation_id UUID NOT NULL REFERENCES public.crm_reactivations(id) ON DELETE CASCADE,
  attempt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT NOT NULL,
  outcome TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_reactivations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_reactivation_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access" ON public.crm_reactivations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.crm_reactivation_attempts FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_crm_reactivations_updated_at
BEFORE UPDATE ON public.crm_reactivations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_crm_reactivation_attempts_reactivation ON public.crm_reactivation_attempts(reactivation_id);