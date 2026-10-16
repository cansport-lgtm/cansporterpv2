-- ============================================================================
-- Auto-cancel: judge a sales order by what was dispatched from it
-- ----------------------------------------------------------------------------
-- 20261015120000_auto_cancel_stale_orders.sql skipped any sales order that a
-- dispatch header pointed at (sales_dispatches.order_id or a
-- sales_dispatch_orders link). A multi-order dispatch can carry a link to an
-- order none of whose lines it actually carries: SO-00779 (KIDCO) is linked
-- to DC-00141, whose two lines are both SO-00821's, so it stayed open.
--
-- Now a sales order is skipped only when a dispatch line was made from one
-- of its own lines (sales_dispatch_items) or a line shows dispatched dozens.
-- Everything else in the function is unchanged.
-- Rollback: re-run the function from 20261015120000_auto_cancel_stale_orders.sql.
-- ============================================================================

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
       AND NOT EXISTS (SELECT 1 FROM public.sales_dispatch_items di
                         JOIN public.sales_order_items i ON i.id = di.order_item_id
                        WHERE i.order_id = so.id)
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
