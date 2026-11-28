-- Rollback for 20261201120000_rw_daily_report.sql
-- Drops the R&W daily reports (all remarks, snapshots and history are lost) and
-- unlocks entry editing on submitted days.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rw-daily-report-due';
  END IF;
END $$;

DROP TRIGGER IF EXISTS rw_rejections_lock_day ON public.rw_rejections;
DROP TRIGGER IF EXISTS rw_wastages_lock_day ON public.rw_wastages;
DROP TRIGGER IF EXISTS rw_leakages_lock_day ON public.rw_leakages;
DROP FUNCTION IF EXISTS public.rw_block_locked_day();
DROP FUNCTION IF EXISTS public.rw_daily_report_notify_due();
DROP FUNCTION IF EXISTS public.rw_daily_report_settings_save(boolean, date, time, time, integer, integer, time);
DROP FUNCTION IF EXISTS public.rw_daily_report_reopen(date, text);
DROP FUNCTION IF EXISTS public.rw_daily_report_review(date, boolean, text);
DROP FUNCTION IF EXISTS public.rw_daily_report_save(date, text, text, text, boolean);
DROP FUNCTION IF EXISTS public.rw_daily_report_days(date, date);
DROP FUNCTION IF EXISTS public.rw_daily_report_figures(date);
DROP FUNCTION IF EXISTS public.rw_daily_report_is_writer();
DROP FUNCTION IF EXISTS public.rw_daily_report_clear_alerts(date);
DROP FUNCTION IF EXISTS public.rw_daily_report_ref(date);
DROP TABLE IF EXISTS public.rw_daily_report_alerts;
DROP TABLE IF EXISTS public.rw_daily_report_history;
DROP TABLE IF EXISTS public.rw_daily_reports;
DROP TABLE IF EXISTS public.rw_daily_report_settings;
NOTIFY pgrst, 'reload schema';
