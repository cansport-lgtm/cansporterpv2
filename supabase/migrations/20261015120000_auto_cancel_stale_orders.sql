-- ============================================================================
-- Sales and purchase orders cancel themselves after 30 days
-- ----------------------------------------------------------------------------
-- Every night (00:05 in Pakistan) a pg_cron job cancels each sales order and
-- purchase order whose order date is 30 or more days back and that nothing
-- has happened against yet:
--
--   Sales order      status draft / confirmed / in_production / ready,
--                    no dispatch (sales_dispatches or sales_dispatch_orders)
--                    and no dispatched dozens on any line.
--   Purchase order   status draft / pending_approval / approved / ordered,
--                    not closed short, no GRN, no QC inspection, no live gate
--                    inward entry (anything but cancelled / rejected) and no
--                    received quantity on any line.
--
-- Orders that have been partly dispatched or received are left alone: they
-- carry stock and accounting history, and closing them is a person's call
-- (Close Short on a PO, Delivered on a sales order).
--
-- A cancelled order gets auto_cancelled_at so the pages can say why, and one
-- note goes to the sales and purchase roles listing the order numbers.
-- Rollback: supabase/rollbacks/20261015120000_auto_cancel_stale_orders_down.sql
-- ============================================================================

ALTER TABLE public.sales_orders    ADD COLUMN IF NOT EXISTS auto_cancelled_at timestamptz;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS auto_cancelled_at timestamptz;

COMMENT ON COLUMN public.sales_orders.auto_cancelled_at IS
  'Set when auto_cancel_stale_orders() cancelled the order for being 30+ days old with no dispatch.';
COMMENT ON COLUMN public.purchase_orders.auto_cancelled_at IS
  'Set when auto_cancel_stale_orders() cancelled the order for being 30+ days old with nothing received.';

CREATE OR REPLACE FUNCTION public.auto_cancel_stale_orders(p_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_cutoff date := (now() AT TIME ZONE 'Asia/Karachi')::date - p_days;
  v_so text[];
  v_po text[];
BEGIN
  WITH stale AS (
    UPDATE public.sales_orders so
       SET status = 'cancelled', auto_cancelled_at = now(), updated_at = now()
     WHERE so.status IN ('draft', 'confirmed', 'in_production', 'ready')
       AND so.order_date <= v_cutoff
       AND NOT EXISTS (SELECT 1 FROM public.sales_dispatches d WHERE d.order_id = so.id)
       AND NOT EXISTS (SELECT 1 FROM public.sales_dispatch_orders d WHERE d.order_id = so.id)
       AND NOT EXISTS (SELECT 1 FROM public.sales_order_items i
                        WHERE i.order_id = so.id AND COALESCE(i.quantity_dispatched, 0) > 0)
    RETURNING so.order_number
  )
  SELECT array_agg(order_number ORDER BY order_number) INTO v_so FROM stale;

  WITH stale AS (
    UPDATE public.purchase_orders po
       SET status = 'cancelled', auto_cancelled_at = now(), updated_at = now()
     WHERE po.status IN ('draft', 'pending_approval', 'approved', 'ordered')
       AND po.order_date <= v_cutoff
       AND po.closed_short_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.goods_receipt_notes g WHERE g.purchase_order_id = po.id)
       AND NOT EXISTS (SELECT 1 FROM public.purchase_qc_inspections q WHERE q.purchase_order_id = po.id)
       AND NOT EXISTS (SELECT 1 FROM public.gate_inward_entries e
                        WHERE e.purchase_order_id = po.id AND e.status NOT IN ('cancelled', 'rejected'))
       AND NOT EXISTS (SELECT 1 FROM public.purchase_order_items i
                        WHERE i.order_id = po.id AND COALESCE(i.quantity_received, 0) > 0)
    RETURNING po.po_number
  )
  SELECT array_agg(po_number ORDER BY po_number) INTO v_po FROM stale;

  IF v_so IS NOT NULL THEN
    PERFORM public.notify_role(ARRAY['super_admin', 'admin', 'sales_order_manager']::app_role[],
      'Sales orders auto-cancelled',
      cardinality(v_so) || ' sales order(s) older than ' || p_days || ' days with no dispatch were cancelled: '
        || array_to_string(v_so, ', '),
      'warning', 'sales', '/sales/orders', 'sales_order', NULL, NULL, NULL);
  END IF;

  IF v_po IS NOT NULL THEN
    PERFORM public.notify_role(ARRAY['super_admin', 'admin', 'purchase_manager', 'purchase_officer']::app_role[],
      'Purchase orders auto-cancelled',
      cardinality(v_po) || ' purchase order(s) older than ' || p_days || ' days with nothing received were cancelled: '
        || array_to_string(v_po, ', '),
      'warning', 'purchase', '/purchase/orders', 'purchase_order', NULL, NULL, NULL);
  END IF;

  RETURN jsonb_build_object(
    'sales_orders', COALESCE(to_jsonb(v_so), '[]'::jsonb),
    'purchase_orders', COALESCE(to_jsonb(v_po), '[]'::jsonb));
END;
$$;

-- Only the cron job (postgres) runs this.
REVOKE EXECUTE ON FUNCTION public.auto_cancel_stale_orders(integer) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'auto-cancel-stale-orders';
    -- 19:05 UTC = 00:05 in Pakistan.
    PERFORM cron.schedule('auto-cancel-stale-orders', '5 19 * * *', 'SELECT public.auto_cancel_stale_orders(30)');
  END IF;
END $$;
