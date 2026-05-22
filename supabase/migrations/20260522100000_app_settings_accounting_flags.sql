-- ============================================================
-- app_settings — runtime-toggleable system flags
--
-- Replaces VITE_ENABLE_ACC_AUTOPOST / VITE_ENABLE_PERPETUAL_COGS env
-- vars with DB-backed settings so a super-admin can flip them from
-- the UI without redeploying.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_settings_read_all" ON public.app_settings;
CREATE POLICY "app_settings_read_all" ON public.app_settings FOR SELECT USING (true);

DROP POLICY IF EXISTS "app_settings_write_all" ON public.app_settings;
CREATE POLICY "app_settings_write_all" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_app_setting_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_app_setting ON public.app_settings;
CREATE TRIGGER trg_touch_app_setting
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_app_setting_updated_at();

-- Seed defaults (both ON to preserve current behavior).
INSERT INTO public.app_settings (key, value, description) VALUES
  ('accounting_autopost_enabled', 'true'::jsonb,
   'Master switch for accounting auto-post (sales→AR, purchase→AP, sales/purchase returns, periodic COGS). Disable to halt all automatic GL postings.'),
  ('perpetual_cogs_enabled', 'true'::jsonb,
   'Whether per-dispatch COGS (Dr COGS / Cr FG at standard cost) auto-posts on dispatch creation. Disable if you prefer periodic-only COGS.')
ON CONFLICT (key) DO NOTHING;
