-- Rollback for 20261129120000_auto_complete_partial_orders.sql
-- Orders already auto-completed go back to Partially Dispatched; the status
-- constraint keeps 'completed' (it was already referenced by the status rule).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auto-complete-partial-orders';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sales_dispatch_reopen_auto_completed ON public.sales_dispatch_items;
DROP FUNCTION IF EXISTS public.sales_dispatch_reopen_auto_completed();
DROP FUNCTION IF EXISTS public.auto_complete_partial_orders(integer);

UPDATE public.sales_orders
   SET status = 'partially_dispatched', updated_at = now()
 WHERE auto_completed_at IS NOT NULL AND status = 'completed';

ALTER TABLE public.sales_orders DROP COLUMN IF EXISTS auto_completed_at;
