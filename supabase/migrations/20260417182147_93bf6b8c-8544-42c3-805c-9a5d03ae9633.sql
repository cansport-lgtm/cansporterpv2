
-- =========================================
-- CRM Module Tables
-- =========================================

-- crm_leads
CREATE TABLE public.crm_leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  email TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  assigned_to UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  notes TEXT,
  converted_deal_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- crm_contacts
CREATE TABLE public.crm_contacts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  designation TEXT,
  company TEXT,
  phone TEXT,
  email TEXT,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- crm_deals
CREATE TABLE public.crm_deals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  deal_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  contact_id UUID REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'prospecting',
  value NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  expected_close_date DATE,
  probability INTEGER DEFAULT 0,
  owner_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  lost_reason TEXT,
  won_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add FK from crm_leads.converted_deal_id to crm_deals.id
ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_converted_deal_id_fkey
  FOREIGN KEY (converted_deal_id) REFERENCES public.crm_deals(id) ON DELETE SET NULL;

-- crm_activities
CREATE TABLE public.crm_activities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  activity_type TEXT NOT NULL DEFAULT 'task',
  subject TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  related_to TEXT,
  related_id UUID,
  owner_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_crm_leads_status ON public.crm_leads(status);
CREATE INDEX idx_crm_leads_assigned_to ON public.crm_leads(assigned_to);
CREATE INDEX idx_crm_deals_stage ON public.crm_deals(stage);
CREATE INDEX idx_crm_deals_owner_id ON public.crm_deals(owner_id);
CREATE INDEX idx_crm_activities_related ON public.crm_activities(related_to, related_id);
CREATE INDEX idx_crm_activities_owner_id ON public.crm_activities(owner_id);
CREATE INDEX idx_crm_activities_due_date ON public.crm_activities(due_date);

-- =========================================
-- Auto-numbering triggers
-- =========================================

CREATE OR REPLACE FUNCTION public.generate_crm_lead_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_max_num INTEGER;
BEGIN
  IF NEW.lead_number IS NOT NULL AND NEW.lead_number <> '' THEN
    RETURN NEW;
  END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN lead_number LIKE 'LD-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(lead_number FROM 7), '')::INTEGER
         ELSE 0 END
  ), 0) + 1 INTO v_max_num
  FROM public.crm_leads
  WHERE lead_number LIKE 'LD-' || v_year || '-%';
  NEW.lead_number := 'LD-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crm_leads_number
BEFORE INSERT ON public.crm_leads
FOR EACH ROW
EXECUTE FUNCTION public.generate_crm_lead_number();

CREATE OR REPLACE FUNCTION public.generate_crm_deal_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_max_num INTEGER;
BEGIN
  IF NEW.deal_number IS NOT NULL AND NEW.deal_number <> '' THEN
    RETURN NEW;
  END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN deal_number LIKE 'DL-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(deal_number FROM 7), '')::INTEGER
         ELSE 0 END
  ), 0) + 1 INTO v_max_num
  FROM public.crm_deals
  WHERE deal_number LIKE 'DL-' || v_year || '-%';
  NEW.deal_number := 'DL-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_crm_deals_number
BEFORE INSERT ON public.crm_deals
FOR EACH ROW
EXECUTE FUNCTION public.generate_crm_deal_number();

-- updated_at triggers
CREATE TRIGGER trg_crm_leads_updated_at
BEFORE UPDATE ON public.crm_leads
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_crm_contacts_updated_at
BEFORE UPDATE ON public.crm_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_crm_deals_updated_at
BEFORE UPDATE ON public.crm_deals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_crm_activities_updated_at
BEFORE UPDATE ON public.crm_activities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================
-- RLS (permissive, granted to anon — matches project standard)
-- =========================================

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to crm_leads" ON public.crm_leads
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to crm_contacts" ON public.crm_contacts
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to crm_deals" ON public.crm_deals
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all access to crm_activities" ON public.crm_activities
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
