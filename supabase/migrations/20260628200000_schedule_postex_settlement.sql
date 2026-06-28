-- Daily PostEx settlement sync: checks each delivered parcel's payout status
-- (settled / settlement date / payment reference) so the Money dashboard shows
-- what the courier has actually paid out vs. what is still owed.

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'postex-settlement-sync';

SELECT cron.schedule(
  'postex-settlement-sync',
  '30 2 * * *',
  $$
  SELECT net.http_post(
    url := 'https://ojejlhnthhdvgbgpsgvi.supabase.co/functions/v1/postex',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_maHf4XFU4sbsRHv1Z-8jgw_5qoDvpYq"}'::jsonb,
    body := '{"action":"settlement"}'::jsonb,
    timeout_milliseconds := 5000
  );
  $$
);
