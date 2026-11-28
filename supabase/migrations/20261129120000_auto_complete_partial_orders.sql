-- ============================================================================
-- Partially dispatched sales orders complete themselves after 15 days
-- ----------------------------------------------------------------------------
-- Every night (00:15 in Pakistan) a pg_cron job completes each sales order
-- that is Partially Dispatched and whose last dispatch is 15 or more days
-- back. The last dispatch is the latest dispatch_date among dispatches that
-- carry a line made from one of the order's own lines (sales_dispatch_items),
-- not sales_dispatches.order_id, so multi-order dispatches count correctly.
--
-- The undispatched balance is left on the order lines (short-closed): nothing
-- is written off. auto_completed_at marks the order so the pages can say so.
--
-- If a dispatch is saved against an auto-completed order later, the order is
-- reopened as Partially Dispatched (auto_completed_at cleared) and the usual
-- status rule then moves it to Dispatched if the lines are now fully sent.
-- Orders completed by hand (auto_completed_at null) are never reopened.
-- Rollback: supabase/rollbacks/20261129120000_auto_complete_partial_orders_down.sql
-- ============================================================================

-- 1. 'completed' must be an allowed sales order status ---------------------------

DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.sales_orders'::regclass AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%status%'
       AND pg_get_constraintdef(oid) ILIKE '%partially_dispatched%'
  LOOP
    EXECUTE format('ALTER TABLE public.sales_orders DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE public.sales_orders ADD CONSTRAINT sales_orders_status_check
    CHECK (status IN ('draft', 'confirmed', 'in_production', 'ready', 'partially_dispatched',
                      'dispatched', 'delivered', 'completed', 'cancelled'));
END $$;

ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS auto_completed_at timestamptz;
COMMENT ON COLUMN public.sales_orders.auto_completed_at IS
  'Set when auto_complete_partial_orders() completed the order (short-closed) 15+ days after its last dispatch.';

-- 2. The nightly job -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_complete_partial_orders(p_days integer DEFAULT 15)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cutoff date := (now() AT TIME ZONE 'Asia/Karachi')::date - p_days;
  v_so text[];
BEGIN
  WITH done AS (
    UPDATE public.sales_orders so
       SET status = 'completed', auto_completed_at = now(), updated_at = now()
     WHERE so.status = 'partially_dispatched'
       AND (SELECT max(d.dispatch_date)
              FROM public.sales_dispatch_items di
              JOIN public.sales_dispatches d ON d.id = di.dispatch_id
              JOIN public.sales_order_items i ON i.id = di.order_item_id
             WHERE i.order_id = so.id) <= v_cutoff
    RETURNING so.order_number
  )
  SELECT array_agg(order_number ORDER BY order_number) INTO v_so FROM done;

  IF v_so IS NOT NULL THEN
    PERFORM public.notify_role(ARRAY['super_admin', 'admin', 'sales_order_manager']::app_role[],
      'Sales orders auto-completed',
      cardinality(v_so) || ' partially dispatched order(s) with no dispatch for ' || p_days
        || ' days were completed (balance short-closed): ' || array_to_string(v_so, ', '),
      'info', 'sales', '/sales/orders', 'sales_order', NULL, NULL, NULL);
  END IF;

  RETURN jsonb_build_object('sales_orders', COALESCE(to_jsonb(v_so), '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_complete_partial_orders(integer) FROM PUBLIC, anon, authenticated;

-- 3. A new dispatch reopens an auto-completed order -------------------------------
--    Named trg_* so it fires before update_dispatched_qty (name order), i.e.
--    before the status rule runs, which skips completed orders.

CREATE OR REPLACE FUNCTION public.sales_dispatch_reopen_auto_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE public.sales_orders so
     SET status = 'partially_dispatched', auto_completed_at = NULL, updated_at = now()
   WHERE so.id = (SELECT i.order_id FROM public.sales_order_items i WHERE i.id = NEW.order_item_id)
     AND so.status = 'completed'
     AND so.auto_completed_at IS NOT NULL;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sales_dispatch_reopen_auto_completed
  AFTER INSERT ON public.sales_dispatch_items
  FOR EACH ROW EXECUTE FUNCTION public.sales_dispatch_reopen_auto_completed();

-- 4. Schedule --------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auto-complete-partial-orders';
    -- 19:15 UTC = 00:15 in Pakistan.
    PERFORM cron.schedule('auto-complete-partial-orders', '15 19 * * *', 'SELECT public.auto_complete_partial_orders(15)');
  END IF;
END $$;
