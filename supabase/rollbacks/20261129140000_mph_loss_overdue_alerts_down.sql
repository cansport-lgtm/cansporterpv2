-- Rollback for 20261129140000_mph_loss_overdue_alerts.sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mph-loss-overdue-alerts';
  END IF;
END $$;
DROP TRIGGER IF EXISTS trg_mph_loss_reports_stage_reset ON public.mph_loss_reports;
DROP FUNCTION IF EXISTS public.mph_loss_reports_stage_reset();
DROP FUNCTION IF EXISTS public.mph_loss_notify_overdue(integer);
ALTER TABLE public.mph_loss_reports
  DROP COLUMN IF EXISTS hr_returned_at,
  DROP COLUMN IF EXISTS unsubmitted_alerted_at,
  DROP COLUMN IF EXISTS unapproved_alerted_at;
