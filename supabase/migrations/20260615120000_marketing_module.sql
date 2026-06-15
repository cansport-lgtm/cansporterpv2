-- Marketing module: ported from v1 lineage into v2.
-- 10 tables + auto-number trigger functions + updated_at triggers + anon-auth RLS.
-- App uses custom app-layer auth (client connects as anon), so every table gets a single
-- permissive "Allow all TO public" policy, matching the existing v2 convention.

-- =====================================================================
-- 1. Tables
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_number text NOT NULL,
  name text NOT NULL,
  description text,
  owner_user_id uuid,
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  budget numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaigns_campaign_number_key UNIQUE (campaign_number)
);

CREATE TABLE IF NOT EXISTS public.marketing_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_channels_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.marketing_milestone_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_milestone_templates_name_key UNIQUE (name)
);

CREATE TABLE IF NOT EXISTS public.marketing_deliverable_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  default_template_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_deliverable_types_name_key UNIQUE (name),
  CONSTRAINT marketing_deliverable_types_default_template_id_fkey
    FOREIGN KEY (default_template_id) REFERENCES public.marketing_milestone_templates(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.marketing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_number text NOT NULL,
  name text NOT NULL,
  event_type text,
  venue text,
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  budget numeric NOT NULL DEFAULT 0,
  owner_user_id uuid,
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_events_event_number_key UNIQUE (event_number)
);

CREATE TABLE IF NOT EXISTS public.marketing_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_number text NOT NULL,
  meeting_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL,
  agenda text,
  attendees text,
  minutes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_meetings_meeting_number_key UNIQUE (meeting_number)
);

CREATE TABLE IF NOT EXISTS public.marketing_deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_number text NOT NULL,
  title text NOT NULL,
  description text,
  deliverable_type_id uuid,
  channel_id uuid,
  campaign_id uuid,
  event_id uuid,
  meeting_id uuid,
  owner_user_id uuid,
  approver_user_id uuid,
  priority text NOT NULL DEFAULT 'medium',
  planned_start date,
  planned_end date,
  actual_start date,
  actual_end date,
  publish_date date,
  status text NOT NULL DEFAULT 'Draft',
  remarks text,
  attachment_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_deliverables_deliverable_number_key UNIQUE (deliverable_number),
  CONSTRAINT marketing_deliverables_deliverable_type_id_fkey
    FOREIGN KEY (deliverable_type_id) REFERENCES public.marketing_deliverable_types(id) ON DELETE SET NULL,
  CONSTRAINT marketing_deliverables_channel_id_fkey
    FOREIGN KEY (channel_id) REFERENCES public.marketing_channels(id) ON DELETE SET NULL,
  CONSTRAINT marketing_deliverables_campaign_id_fkey
    FOREIGN KEY (campaign_id) REFERENCES public.marketing_campaigns(id) ON DELETE SET NULL,
  CONSTRAINT marketing_deliverables_event_id_fkey
    FOREIGN KEY (event_id) REFERENCES public.marketing_events(id) ON DELETE SET NULL,
  CONSTRAINT marketing_deliverables_meeting_id_fkey
    FOREIGN KEY (meeting_id) REFERENCES public.marketing_meetings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.marketing_meeting_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL,
  action_text text NOT NULL,
  owner_user_id uuid,
  due_date date,
  status text NOT NULL DEFAULT 'Draft',
  completed_at timestamptz,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_meeting_actions_meeting_id_fkey
    FOREIGN KEY (meeting_id) REFERENCES public.marketing_meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.marketing_milestone_template_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL,
  stage_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  default_offset_days integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_milestone_template_stages_template_id_fkey
    FOREIGN KEY (template_id) REFERENCES public.marketing_milestone_templates(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.marketing_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id uuid NOT NULL,
  stage_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  planned_date date,
  actual_date date,
  completed_by uuid,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_milestones_deliverable_id_fkey
    FOREIGN KEY (deliverable_id) REFERENCES public.marketing_deliverables(id) ON DELETE CASCADE
);

-- Indexes (match v1)
CREATE INDEX IF NOT EXISTS idx_mkt_deliv_campaign  ON public.marketing_deliverables (campaign_id);
CREATE INDEX IF NOT EXISTS idx_mkt_deliv_event     ON public.marketing_deliverables (event_id);
CREATE INDEX IF NOT EXISTS idx_mkt_deliv_publish   ON public.marketing_deliverables (publish_date);
CREATE INDEX IF NOT EXISTS idx_mkt_deliv_status    ON public.marketing_deliverables (status);
CREATE INDEX IF NOT EXISTS idx_mkt_milestones_deliv ON public.marketing_milestones (deliverable_id);

-- =====================================================================
-- 2. Auto-number trigger functions (pages insert *_number = '' and rely on these)
-- =====================================================================

CREATE OR REPLACE FUNCTION public.generate_marketing_campaign_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year TEXT; v_max INT;
BEGIN
  IF NEW.campaign_number IS NOT NULL AND NEW.campaign_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN campaign_number LIKE 'MKC-' || v_year || '-%'
      THEN NULLIF(SUBSTRING(campaign_number FROM 8), '')::INT ELSE 0 END
  ), 0) + 1 INTO v_max FROM public.marketing_campaigns;
  NEW.campaign_number := 'MKC-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.generate_marketing_deliverable_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year TEXT; v_max INT;
BEGIN
  IF NEW.deliverable_number IS NOT NULL AND NEW.deliverable_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN deliverable_number LIKE 'MKD-' || v_year || '-%'
      THEN NULLIF(SUBSTRING(deliverable_number FROM 8), '')::INT ELSE 0 END
  ), 0) + 1 INTO v_max FROM public.marketing_deliverables;
  NEW.deliverable_number := 'MKD-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.generate_marketing_event_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year TEXT; v_max INT;
BEGIN
  IF NEW.event_number IS NOT NULL AND NEW.event_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN event_number LIKE 'MKE-' || v_year || '-%'
      THEN NULLIF(SUBSTRING(event_number FROM 8), '')::INT ELSE 0 END
  ), 0) + 1 INTO v_max FROM public.marketing_events;
  NEW.event_number := 'MKE-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.generate_marketing_meeting_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year TEXT; v_max INT;
BEGIN
  IF NEW.meeting_number IS NOT NULL AND NEW.meeting_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN meeting_number LIKE 'MTG-' || v_year || '-%'
      THEN NULLIF(SUBSTRING(meeting_number FROM 8), '')::INT ELSE 0 END
  ), 0) + 1 INTO v_max FROM public.marketing_meetings;
  NEW.meeting_number := 'MTG-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END; $$;

-- =====================================================================
-- 3. Triggers
-- =====================================================================

DROP TRIGGER IF EXISTS trg_mkc_number ON public.marketing_campaigns;
CREATE TRIGGER trg_mkc_number BEFORE INSERT ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.generate_marketing_campaign_number();
DROP TRIGGER IF EXISTS trg_mkc_updated ON public.marketing_campaigns;
CREATE TRIGGER trg_mkc_updated BEFORE UPDATE ON public.marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_mkd_number ON public.marketing_deliverables;
CREATE TRIGGER trg_mkd_number BEFORE INSERT ON public.marketing_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.generate_marketing_deliverable_number();
DROP TRIGGER IF EXISTS trg_mkd_updated ON public.marketing_deliverables;
CREATE TRIGGER trg_mkd_updated BEFORE UPDATE ON public.marketing_deliverables
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_mke_number ON public.marketing_events;
CREATE TRIGGER trg_mke_number BEFORE INSERT ON public.marketing_events
  FOR EACH ROW EXECUTE FUNCTION public.generate_marketing_event_number();
DROP TRIGGER IF EXISTS trg_mke_updated ON public.marketing_events;
CREATE TRIGGER trg_mke_updated BEFORE UPDATE ON public.marketing_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_mtg_number ON public.marketing_meetings;
CREATE TRIGGER trg_mtg_number BEFORE INSERT ON public.marketing_meetings
  FOR EACH ROW EXECUTE FUNCTION public.generate_marketing_meeting_number();
DROP TRIGGER IF EXISTS trg_mtg_updated ON public.marketing_meetings;
CREATE TRIGGER trg_mtg_updated BEFORE UPDATE ON public.marketing_meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_mkt_actions_updated ON public.marketing_meeting_actions;
CREATE TRIGGER trg_mkt_actions_updated BEFORE UPDATE ON public.marketing_meeting_actions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_mkt_channels_updated ON public.marketing_channels;
CREATE TRIGGER trg_mkt_channels_updated BEFORE UPDATE ON public.marketing_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_mkt_milestones_updated ON public.marketing_milestones;
CREATE TRIGGER trg_mkt_milestones_updated BEFORE UPDATE ON public.marketing_milestones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_mkt_tpl_updated ON public.marketing_milestone_templates;
CREATE TRIGGER trg_mkt_tpl_updated BEFORE UPDATE ON public.marketing_milestone_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_mkt_types_updated ON public.marketing_deliverable_types;
CREATE TRIGGER trg_mkt_types_updated BEFORE UPDATE ON public.marketing_deliverable_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================================
-- 4. RLS: anon-auth model (Allow all TO public)
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'marketing_campaigns','marketing_channels','marketing_deliverable_types',
    'marketing_deliverables','marketing_events','marketing_meeting_actions',
    'marketing_meetings','marketing_milestone_template_stages',
    'marketing_milestone_templates','marketing_milestones'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
