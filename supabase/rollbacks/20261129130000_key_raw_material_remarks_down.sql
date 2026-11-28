-- Rollback for 20261129130000_key_raw_material_remarks.sql
-- Drops the key raw material remarks (all remarks and their history are lost).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'key-rm-remarks-due';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.key_rm_remark_notify_due();
DROP FUNCTION IF EXISTS public.key_rm_remark_settings_save(boolean, date, integer, integer, integer, time);
DROP FUNCTION IF EXISTS public.key_rm_remark_reopen(date, text);
DROP FUNCTION IF EXISTS public.key_rm_remark_review(date, boolean, text);
DROP FUNCTION IF EXISTS public.key_rm_remark_save(date, text, boolean);
DROP FUNCTION IF EXISTS public.key_rm_remark_days(date, date);
DROP FUNCTION IF EXISTS public.key_rm_remark_is_writer();
DROP FUNCTION IF EXISTS public.key_rm_remark_clear_alerts(date);
DROP FUNCTION IF EXISTS public.key_rm_remark_ref(date);
DROP TABLE IF EXISTS public.consumption_key_rm_remark_alerts;
DROP TABLE IF EXISTS public.consumption_key_rm_remark_history;
DROP TABLE IF EXISTS public.consumption_key_rm_remarks;
DROP TABLE IF EXISTS public.consumption_key_rm_remark_settings;
