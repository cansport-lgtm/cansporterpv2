-- Rollback for 20261023120000_gate_pass_unscanned_alert.sql.
-- Stops the unscanned gate pass alert and removes its settings and tracking.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gate-pass-unscanned';
  END IF;
END $$;

DROP TRIGGER IF EXISTS gate_pass_clear_unscanned_on_status ON public.gate_passes;
DROP FUNCTION IF EXISTS public.gate_pass_clear_unscanned_on_status();
DROP FUNCTION IF EXISTS public.gate_pass_notify_unscanned();
DROP FUNCTION IF EXISTS public.gate_pass_clear_unscanned_alerts(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_unscanned_settings_save(boolean, integer, time);
DROP TABLE IF EXISTS public.gate_pass_unscanned_alerts;

ALTER TABLE public.gate_pass_settings
  DROP COLUMN IF EXISTS unscanned_alert_enabled,
  DROP COLUMN IF EXISTS unscanned_alert_hours,
  DROP COLUMN IF EXISTS unscanned_alert_time;
