-- ============================================================================
-- Rollback of 20261015120000_auto_cancel_stale_orders.sql
-- ----------------------------------------------------------------------------
-- Stops the nightly job and drops the function and the auto_cancelled_at
-- columns. Orders the job already cancelled stay cancelled.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auto-cancel-stale-orders';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.auto_cancel_stale_orders(integer);

ALTER TABLE public.sales_orders    DROP COLUMN IF EXISTS auto_cancelled_at;
ALTER TABLE public.purchase_orders DROP COLUMN IF EXISTS auto_cancelled_at;
