-- Unscanned gate pass alert
--
-- A goods gate pass that is not scanned out at the gate within N hours of being
-- created (default 24) raises a red alert to every super admin — in the bell and
-- as a Web Push. The alert repeats once a day, at the set Pakistan time, until
-- the pass is scanned out, cancelled or rejected. Each pass keeps only its
-- latest alert unread; leaving the waiting states clears it.
--
-- Settings (super admin only): on/off, hours after creation, daily alert time.

-- 1. Settings ------------------------------------------------------------------

ALTER TABLE public.gate_pass_settings
  ADD COLUMN IF NOT EXISTS unscanned_alert_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unscanned_alert_hours integer NOT NULL DEFAULT 24
    CHECK (unscanned_alert_hours BETWEEN 1 AND 168),
  ADD COLUMN IF NOT EXISTS unscanned_alert_time time NOT NULL DEFAULT '09:00';

CREATE OR REPLACE FUNCTION public.gate_pass_unscanned_settings_save(
  p_enabled boolean, p_hours integer, p_time time
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change gate pass settings.';
  END IF;
  IF p_hours IS NULL OR p_hours NOT BETWEEN 1 AND 168 THEN
    RAISE EXCEPTION 'Hours must be between 1 and 168.';
  END IF;
  UPDATE public.gate_pass_settings
     SET unscanned_alert_enabled = COALESCE(p_enabled, true),
         unscanned_alert_hours = p_hours,
         unscanned_alert_time = COALESCE(p_time, '09:00'),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 2. Which passes have been alerted, and how many times ------------------------
-- Kept apart from gate_passes so the daily job never fires its update triggers.

CREATE TABLE IF NOT EXISTS public.gate_pass_unscanned_alerts (
  gate_pass_id uuid PRIMARY KEY REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  alert_count integer NOT NULL DEFAULT 0,
  first_alerted_at timestamptz NOT NULL DEFAULT now(),
  last_alerted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.gate_pass_unscanned_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read gate_pass_unscanned_alerts" ON public.gate_pass_unscanned_alerts;
CREATE POLICY "Read gate_pass_unscanned_alerts" ON public.gate_pass_unscanned_alerts
  FOR SELECT TO public USING (public.gate_pass_is_super_admin());
GRANT SELECT ON public.gate_pass_unscanned_alerts TO anon, authenticated, service_role;
GRANT ALL ON public.gate_pass_unscanned_alerts TO service_role;

-- 3. Clearing ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gate_pass_clear_unscanned_alerts(p_pass uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.notifications
     SET is_read = true, read_at = COALESCE(read_at, now())
   WHERE reference_type = 'gate_pass' AND reference_id = p_pass
     AND title = 'Gate pass not scanned' AND NOT is_read;
$$;

-- Scanned out, cancelled or rejected: the alert is done with.
CREATE OR REPLACE FUNCTION public.gate_pass_clear_unscanned_on_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.status IN ('draft','pending_approval','approved','held')
     AND NEW.status NOT IN ('draft','pending_approval','approved','held') THEN
    PERFORM public.gate_pass_clear_unscanned_alerts(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS gate_pass_clear_unscanned_on_status ON public.gate_passes;
CREATE TRIGGER gate_pass_clear_unscanned_on_status
  AFTER UPDATE OF status ON public.gate_passes
  FOR EACH ROW EXECUTE FUNCTION public.gate_pass_clear_unscanned_on_status();

-- 4. The check -----------------------------------------------------------------
-- Runs every 15 minutes. A pass past the limit gets its first alert at the next
-- run; after that one alert a day, at the first run on or after the alert time.

CREATE OR REPLACE FUNCTION public.gate_pass_notify_unscanned()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.gate_pass_settings%ROWTYPE;
  r record;
  v_now_pk timestamp := now() AT TIME ZONE 'Asia/Karachi';
  v_age interval;
  v_age_txt text;
  v_day integer;
  v_n integer := 0;
BEGIN
  SELECT * INTO s FROM public.gate_pass_settings WHERE id;
  IF NOT FOUND OR NOT s.unscanned_alert_enabled THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT g.*, u.full_name AS maker_name, a.alert_count, a.last_alerted_at
      FROM public.gate_passes g
      LEFT JOIN public.app_users u ON u.id = g.created_by
      LEFT JOIN public.gate_pass_unscanned_alerts a ON a.gate_pass_id = g.id
     WHERE g.status IN ('draft','pending_approval','approved','held')
       AND g.created_at < now() - make_interval(hours => s.unscanned_alert_hours)
       AND (a.gate_pass_id IS NULL
            OR ((a.last_alerted_at AT TIME ZONE 'Asia/Karachi')::date < v_now_pk::date
                AND v_now_pk::time >= s.unscanned_alert_time))
     ORDER BY g.created_at
  LOOP
    v_day := COALESCE(r.alert_count, 0) + 1;
    v_age := now() - r.created_at;
    v_age_txt := CASE
      WHEN extract(day FROM v_age) >= 1
        THEN extract(day FROM v_age)::int || ' day(s) ' || extract(hour FROM v_age)::int || 'h'
      ELSE extract(hour FROM v_age)::int || 'h' END;

    PERFORM public.gate_pass_clear_unscanned_alerts(r.id);
    PERFORM public.notify_role(
      ARRAY['super_admin']::app_role[], 'Gate pass not scanned',
      'Day ' || v_day || ' · ' || r.pass_number || ' · ' || initcap(replace(r.pass_type, '_', ' '))
        || ' · ' || r.party_name || ' — created '
        || to_char(r.created_at AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI')
        || COALESCE(' by ' || r.maker_name, '')
        || '. Status: ' || initcap(replace(r.status, '_', ' '))
        || '. Not scanned at the gate for ' || v_age_txt || '.',
      'error', 'gate_pass', '/gate-pass/passes/' || r.id::text, 'gate_pass', r.id, NULL, NULL);

    INSERT INTO public.gate_pass_unscanned_alerts (gate_pass_id, alert_count, first_alerted_at, last_alerted_at)
    VALUES (r.id, 1, now(), now())
    ON CONFLICT (gate_pass_id) DO UPDATE
      SET alert_count = public.gate_pass_unscanned_alerts.alert_count + 1, last_alerted_at = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gate-pass-unscanned';
    PERFORM cron.schedule('gate-pass-unscanned', '*/15 * * * *', 'SELECT public.gate_pass_notify_unscanned()');
  END IF;
END $$;

-- 5. Permissions ---------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.gate_pass_unscanned_settings_save(boolean, integer, time)
  TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.gate_pass_notify_unscanned(),
  public.gate_pass_clear_unscanned_alerts(uuid)
FROM PUBLIC, anon, authenticated;
