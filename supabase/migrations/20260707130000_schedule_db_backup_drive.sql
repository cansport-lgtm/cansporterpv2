-- Daily automated database backup to Google Drive.
--
-- Invokes the `db-backup-drive` Edge Function once a day, which dumps the whole
-- database (schema + data), uploads a .sql and .json to a Google Drive folder,
-- and prunes backups older than the retention window.
--
-- Runs at 20:00 UTC (01:00 PKT) — off business hours. Adjust the cron
-- expression below to change the time.
--
-- No secrets are committed here: the `apikey` (publishable, safe) and the
-- `x-backup-secret` guard are read from `integration_secrets` at run time. The
-- cron job runs as the postgres role, which bypasses RLS, so it can read them.
-- These keys must exist in integration_secrets before the job can succeed:
--   supabase_publishable_key, backup_cron_secret
-- (see docs/BACKUP_GOOGLE_DRIVE.md for the full setup).

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'db-backup-drive-daily';

SELECT cron.schedule(
  'db-backup-drive-daily',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ojejlhnthhdvgbgpsgvi.supabase.co/functions/v1/db-backup-drive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (SELECT value FROM public.integration_secrets WHERE key = 'supabase_publishable_key'),
      'x-backup-secret', (SELECT value FROM public.integration_secrets WHERE key = 'backup_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
