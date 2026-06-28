-- Scheduled PostEx tracking sync (every 3 hours) — replaces the manual courier
-- status-sheet upload. Calls the `postex` Edge Function with {"action":"track"},
-- which pulls the latest status for all in-transit parcels and updates orders +
-- tracking events. The apikey below is the public publishable key (safe to commit);
-- the PostEx token is NOT here — it stays in integration_secrets, read server-side.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'postex-track-sync';

SELECT cron.schedule(
  'postex-track-sync',
  '0 */3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ojejlhnthhdvgbgpsgvi.supabase.co/functions/v1/postex',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_maHf4XFU4sbsRHv1Z-8jgw_5qoDvpYq"}'::jsonb,
    body := '{"action":"track"}'::jsonb
  );
  $$
);
