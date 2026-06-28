-- delivered_at: actual delivery timestamp (PostEx status code 0005 "Delivered to
-- Customer"), used to age unpaid COD payouts on the Money dashboard.
ALTER TABLE public.online_orders ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Daily backfill: derive delivered_at from the tracking-event history the track
-- sync already collects (the 0005 step's timestamp). Keeps it current without a
-- function redeploy.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'online-delivered-at-backfill';
SELECT cron.schedule(
  'online-delivered-at-backfill',
  '15 3 * * *',
  $$
  WITH latest AS (
    SELECT DISTINCT ON (order_id) order_id, raw FROM online_tracking_events
    WHERE raw IS NOT NULL ORDER BY order_id, created_at DESC
  ), d AS (
    SELECT l.order_id, max((h->>'updatedAt')::timestamptz) AS dt
    FROM latest l, jsonb_array_elements(l.raw->'dist'->'transactionStatusHistory') h
    WHERE h->>'transactionStatusMessageCode' = '0005'
    GROUP BY l.order_id
  )
  UPDATE public.online_orders o SET delivered_at = d.dt
  FROM d WHERE o.id = d.order_id AND o.delivered_at IS DISTINCT FROM d.dt;
  $$
);
