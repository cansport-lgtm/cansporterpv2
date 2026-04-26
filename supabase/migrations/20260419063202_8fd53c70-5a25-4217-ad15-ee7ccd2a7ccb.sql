
-- Tables
CREATE TABLE public.crm_content_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  asset_type TEXT NOT NULL DEFAULT 'image',
  file_url TEXT,
  thumbnail_url TEXT,
  external_url TEXT,
  body_text TEXT,
  tags TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  owner_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_content_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  objective TEXT,
  channel TEXT NOT NULL DEFAULT 'instagram',
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'planned',
  owner_id UUID REFERENCES public.app_users(id) ON DELETE SET NULL,
  linked_deal_id UUID REFERENCES public.crm_deals(id) ON DELETE SET NULL,
  linked_lead_id UUID REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.crm_content_campaign_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.crm_content_campaigns(id) ON DELETE CASCADE,
  asset_id UUID NOT NULL REFERENCES public.crm_content_assets(id) ON DELETE CASCADE,
  scheduled_date DATE,
  published_at TIMESTAMPTZ,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, asset_id)
);

CREATE INDEX idx_crm_content_assets_status ON public.crm_content_assets(status);
CREATE INDEX idx_crm_content_assets_type ON public.crm_content_assets(asset_type);
CREATE INDEX idx_crm_content_campaigns_status ON public.crm_content_campaigns(status);
CREATE INDEX idx_crm_content_campaign_assets_campaign ON public.crm_content_campaign_assets(campaign_id);
CREATE INDEX idx_crm_content_campaign_assets_asset ON public.crm_content_campaign_assets(asset_id);

-- RLS
ALTER TABLE public.crm_content_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_content_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_content_campaign_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can manage crm content assets" ON public.crm_content_assets
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can manage crm content campaigns" ON public.crm_content_campaigns
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Anyone can manage crm content campaign assets" ON public.crm_content_campaign_assets
  FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- Updated_at triggers
CREATE TRIGGER update_crm_content_assets_updated_at
  BEFORE UPDATE ON public.crm_content_assets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_crm_content_campaigns_updated_at
  BEFORE UPDATE ON public.crm_content_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) 
VALUES ('crm-content', 'crm-content', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read crm-content" ON storage.objects
  FOR SELECT TO anon, authenticated USING (bucket_id = 'crm-content');

CREATE POLICY "Anyone can upload crm-content" ON storage.objects
  FOR INSERT TO anon, authenticated WITH CHECK (bucket_id = 'crm-content');

CREATE POLICY "Anyone can update crm-content" ON storage.objects
  FOR UPDATE TO anon, authenticated USING (bucket_id = 'crm-content');

CREATE POLICY "Anyone can delete crm-content" ON storage.objects
  FOR DELETE TO anon, authenticated USING (bucket_id = 'crm-content');
