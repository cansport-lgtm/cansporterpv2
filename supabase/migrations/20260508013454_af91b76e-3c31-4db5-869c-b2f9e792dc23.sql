
CREATE TABLE public.crm_daily_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_name TEXT,
  activity_date DATE NOT NULL DEFAULT CURRENT_DATE,
  activity_time TIME NOT NULL DEFAULT CURRENT_TIME,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  customer_name TEXT,
  related_lead_id UUID,
  related_deal_id UUID,
  channel TEXT,
  outcome TEXT,
  notes TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_crm_daily_activities_user_date ON public.crm_daily_activities(user_id, activity_date);
CREATE INDEX idx_crm_daily_activities_date ON public.crm_daily_activities(activity_date);

ALTER TABLE public.crm_daily_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_crm_daily_activities" ON public.crm_daily_activities
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_crm_daily_activities" ON public.crm_daily_activities
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_crm_daily_activities_updated
BEFORE UPDATE ON public.crm_daily_activities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.crm_daily_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  user_name TEXT,
  summary_date DATE NOT NULL DEFAULT CURRENT_DATE,
  accomplishments TEXT,
  tomorrow_plan TEXT,
  issues_feedback TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, summary_date)
);

CREATE INDEX idx_crm_daily_summaries_date ON public.crm_daily_summaries(summary_date);

ALTER TABLE public.crm_daily_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all_crm_daily_summaries" ON public.crm_daily_summaries
  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth_all_crm_daily_summaries" ON public.crm_daily_summaries
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_crm_daily_summaries_updated
BEFORE UPDATE ON public.crm_daily_summaries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
