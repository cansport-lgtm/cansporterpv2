
-- Aero Padel Court Tracker

CREATE TABLE public.padel_courts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  venue_name TEXT NOT NULL,
  city TEXT,
  area TEXT,
  google_maps_url TEXT,
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),
  number_of_courts INTEGER DEFAULT 1,
  weekly_play_hours NUMERIC(10,2),
  manager_name TEXT,
  manager_phone TEXT,
  manager_email TEXT,
  current_ball_brand TEXT,
  monthly_consumption_estimate NUMERIC(12,2),
  pipeline_stage TEXT NOT NULL DEFAULT 'identified'
    CHECK (pipeline_stage IN ('identified','contacted','demo_scheduled','demo_completed','trial_supply','house_ball','lost')),
  lost_reason TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.padel_court_interactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  court_id UUID NOT NULL REFERENCES public.padel_courts(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call','whatsapp','visit','demo','tournament')),
  outcome TEXT,
  stage_before TEXT,
  stage_after TEXT,
  follow_up_date DATE,
  notes TEXT,
  performed_by UUID,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_padel_interactions_court ON public.padel_court_interactions(court_id, performed_at DESC);

CREATE TABLE public.padel_demo_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  court_id UUID NOT NULL REFERENCES public.padel_courts(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  attendees_count INTEGER,
  balls_provided NUMERIC(10,2) DEFAULT 0,
  performance_rating SMALLINT CHECK (performance_rating BETWEEN 1 AND 5),
  pressure_retention_rating SMALLINT CHECK (pressure_retention_rating BETWEEN 1 AND 5),
  durability_rating SMALLINT CHECK (durability_rating BETWEEN 1 AND 5),
  manager_feedback TEXT,
  player_feedback TEXT,
  photos_url TEXT[] DEFAULT '{}',
  converted_to_trial BOOLEAN NOT NULL DEFAULT false,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_padel_demos_court ON public.padel_demo_sessions(court_id, scheduled_at DESC);

CREATE TABLE public.padel_supply_agreements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_number TEXT UNIQUE,
  court_id UUID NOT NULL REFERENCES public.padel_courts(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN ('trial','house_ball','exclusive')),
  monthly_volume NUMERIC(12,2),
  unit_price NUMERIC(12,2),
  payment_terms TEXT,
  start_date DATE,
  end_date DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'Draft',
  delivered_volume_mtd NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_padel_agreements_court ON public.padel_supply_agreements(court_id);

-- updated_at triggers
CREATE TRIGGER trg_padel_courts_updated BEFORE UPDATE ON public.padel_courts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_padel_demos_updated BEFORE UPDATE ON public.padel_demo_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_padel_agreements_updated BEFORE UPDATE ON public.padel_supply_agreements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ASA-YYYY-NNNN deterministic numbering (MAX+1 per year)
CREATE OR REPLACE FUNCTION public.generate_padel_agreement_number()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_year TEXT;
  v_max_num INTEGER;
BEGIN
  IF NEW.agreement_number IS NOT NULL AND NEW.agreement_number <> '' THEN
    RETURN NEW;
  END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YYYY');
  SELECT COALESCE(MAX(
    CASE WHEN agreement_number LIKE 'ASA-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(agreement_number FROM 10), '')::INTEGER
         ELSE 0 END
  ), 0) + 1 INTO v_max_num
  FROM public.padel_supply_agreements
  WHERE agreement_number LIKE 'ASA-' || v_year || '-%';
  NEW.agreement_number := 'ASA-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_padel_agreement_number
  BEFORE INSERT ON public.padel_supply_agreements
  FOR EACH ROW EXECUTE FUNCTION public.generate_padel_agreement_number();

-- RLS (project-standard permissive policies on anon role)
ALTER TABLE public.padel_courts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.padel_court_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.padel_demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.padel_supply_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Full access" ON public.padel_courts FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.padel_court_interactions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.padel_demo_sessions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.padel_supply_agreements FOR ALL TO anon USING (true) WITH CHECK (true);
