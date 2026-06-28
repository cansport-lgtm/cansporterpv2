-- Daily full PostEx resync (all AWBs, including delivered/returned) so courier
-- fees, taxes, weights and settlement amounts that finalize AFTER delivery stay
-- current. The 3-hourly postex-track-sync only covers non-terminal parcels;
-- this daily job refreshes the financials on everything.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'postex-financial-resync';

SELECT cron.schedule(
  'postex-financial-resync',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ojejlhnthhdvgbgpsgvi.supabase.co/functions/v1/postex',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_maHf4XFU4sbsRHv1Z-8jgw_5qoDvpYq"}'::jsonb,
    body := '{"action":"track","all":true}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
