-- ============================================================================
-- Admin & Facilities — core: settings, event log, permission helpers
-- ----------------------------------------------------------------------------
-- Shared by every facilities_* sub-module (cameras, cleaning, assets,
-- supplies, SIMs, equipment). Follows the Purchase Requests / Store Pass
-- conventions: tables are read-only to clients, every write goes through a
-- SECURITY DEFINER facilities_* function that checks the caller's role via
-- app_user_id(), and every action is logged in facilities_events.
-- Roles are added in 20261110120000_facilities_roles.sql.
-- Rollback: supabase/rollbacks/20261110120100_facilities_core_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.facilities_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- Local time (Asia/Karachi) after which a missing camera check is reported.
  camera_check_alarm_time time NOT NULL DEFAULT '11:00',
  -- Days before an AMC / service contract expiry that equipment alerts start.
  amc_alert_days integer NOT NULL DEFAULT 30 CHECK (amc_alert_days BETWEEN 0 AND 365),
  -- A high-priority equipment ticket open longer than this is escalated.
  ticket_escalation_days integer NOT NULL DEFAULT 3 CHECK (ticket_escalation_days BETWEEN 0 AND 60),
  -- Day of month by which the SIM bill should be entered.
  sim_bill_due_day integer NOT NULL DEFAULT 10 CHECK (sim_bill_due_day BETWEEN 1 AND 28),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.facilities_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- One timeline table for every facilities document.
CREATE TABLE IF NOT EXISTS public.facilities_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL,   -- camera_check, inspection, action_item, asset_movement, supply_request, sim, sim_bill, ticket, store
  document_id uuid NOT NULL,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_events_document_idx
  ON public.facilities_events (document_type, document_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_settings','facilities_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_has_any_role(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = public.app_user_id() AND role::text = ANY (p_roles)
  );
$$;

-- What the caller may do in the module.
--   'manage'      masters, settings-free management: facilities_manager
--   'operate'     fill checks / inspections, issue and take back, work tickets
--   'technician'  update a ticket assigned to them
--   'cleaning'    close cleaning action items assigned to them
--   'settings'    super admin
CREATE OR REPLACE FUNCTION public.facilities_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.facilities_has_any_role(CASE p_action
    WHEN 'manage'     THEN ARRAY['super_admin','facilities_manager']
    WHEN 'operate'    THEN ARRAY['super_admin','facilities_manager','facilities_officer']
    WHEN 'technician' THEN ARRAY['super_admin','facilities_manager','facilities_officer','facilities_technician']
    WHEN 'cleaning'   THEN ARRAY['super_admin','facilities_manager','facilities_officer','cleaning_supervisor']
    WHEN 'settings'   THEN ARRAY['super_admin']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.facilities_log(
  p_type text, p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.facilities_events (document_type, document_id, event, message, details, created_by)
  VALUES (p_type, p_id, p_event, p_message, p_details, public.app_user_id());
$$;

-- Tell the facilities managers (and super admins); never the actor.
CREATE OR REPLACE FUNCTION public.facilities_notify_managers(
  p_title text, p_message text, p_link text, p_ref_type text DEFAULT NULL, p_ref_id uuid DEFAULT NULL,
  p_type text DEFAULT 'info', p_include_officers boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := public.app_user_id();
BEGIN
  PERFORM public.notify_role(
    CASE WHEN p_include_officers
         THEN ARRAY['super_admin','facilities_manager','facilities_officer']::app_role[]
         ELSE ARRAY['super_admin','facilities_manager']::app_role[] END,
    p_title, p_message, p_type, 'facilities', p_link, p_ref_type, p_ref_id, v_uid, v_uid);
END;
$$;

-- Tell one user; never the actor.
CREATE OR REPLACE FUNCTION public.facilities_notify_user(
  p_user uuid, p_title text, p_message text, p_link text, p_ref_type text DEFAULT NULL, p_ref_id uuid DEFAULT NULL,
  p_type text DEFAULT 'info'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := public.app_user_id();
BEGIN
  IF p_user IS NULL OR p_user IS NOT DISTINCT FROM v_uid THEN RETURN; END IF;
  PERFORM public.notify_user(p_user, p_title, p_message, p_type, 'facilities', p_link, p_ref_type, p_ref_id, v_uid);
END;
$$;

-- Today in the factory's time zone.
CREATE OR REPLACE FUNCTION public.facilities_today()
RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date; $$;

-- Settings (super admin). p_data: any of the facilities_settings columns.
CREATE OR REPLACE FUNCTION public.facilities_settings_save(p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.facilities_can('settings') THEN
    RAISE EXCEPTION 'Only a super admin can change the Admin & Facilities settings.';
  END IF;
  UPDATE public.facilities_settings SET
    camera_check_alarm_time = COALESCE(NULLIF(p_data->>'camera_check_alarm_time','')::time, camera_check_alarm_time),
    amc_alert_days = COALESCE(NULLIF(p_data->>'amc_alert_days','')::integer, amc_alert_days),
    ticket_escalation_days = COALESCE(NULLIF(p_data->>'ticket_escalation_days','')::integer, ticket_escalation_days),
    sim_bill_due_day = COALESCE(NULLIF(p_data->>'sim_bill_due_day','')::integer, sim_bill_due_day),
    updated_by = public.app_user_id(), updated_at = now()
  WHERE id;
END;
$$;

-- 3. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_has_any_role(text[]),
  public.facilities_can(text),
  public.facilities_log(text, uuid, text, text, jsonb),
  public.facilities_notify_managers(text, text, text, text, uuid, text, boolean),
  public.facilities_notify_user(uuid, text, text, text, text, uuid, text),
  public.facilities_today(),
  public.facilities_settings_save(jsonb)
  TO anon, authenticated, service_role;
