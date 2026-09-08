-- Partial Goods Receiving
--
-- A PO can be fulfilled across multiple deliveries, each recorded as its own
-- GRN. Until now the Goods Receipt page marked the PO 'received' after the
-- first GRN regardless of quantities, so a partially delivered PO dropped out
-- of the receivable list and the balance could never be received.
--
-- This migration moves PO receipt-status bookkeeping into the database:
--   1. After any grn_items change, the PO's status is recalculated from its
--      lines: every line fully received -> 'received', some quantity received
--      -> 'partially_received', nothing received (e.g. the only GRN was
--      deleted) -> back to 'approved'. Draft/pending/cancelled POs are never
--      touched.
--   2. A validation trigger rejects receiving more than the ordered quantity
--      on a PO line (over-receipt), summed across all of the line's GRNs.
--   3. Backfill: POs stamped 'received' that still have open lines are
--      corrected to 'partially_received' so their balance can be received.
--
-- Trigger ordering note: AFTER ROW triggers on grn_items fire in name order.
-- The existing trigger_update_po_item_received (maintains
-- purchase_order_items.quantity_received) must run first, so the new triggers
-- are named to sort after it ('u' < 'v' < 'z').

-- ============================================================
-- 1. Recalculate PO status from received quantities
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalc_po_receipt_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_po_id UUID;
  v_open_lines INTEGER;
  v_received NUMERIC;
  v_new_status VARCHAR(50);
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT purchase_order_id INTO v_po_id
    FROM public.goods_receipt_notes WHERE id = OLD.grn_id;
    -- When a whole GRN is deleted, the cascade removes the header before this
    -- row trigger runs; fall back to the PO line to find the order.
    IF v_po_id IS NULL AND OLD.po_item_id IS NOT NULL THEN
      SELECT order_id INTO v_po_id
      FROM public.purchase_order_items WHERE id = OLD.po_item_id;
    END IF;
  ELSE
    SELECT purchase_order_id INTO v_po_id
    FROM public.goods_receipt_notes WHERE id = NEW.grn_id;
  END IF;

  IF v_po_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 0.001 tolerance absorbs NUMERIC(12,2) rounding on fractional quantities.
  SELECT
    COUNT(*) FILTER (WHERE COALESCE(quantity_received, 0) + 0.001 < quantity),
    COALESCE(SUM(quantity_received), 0)
  INTO v_open_lines, v_received
  FROM public.purchase_order_items
  WHERE order_id = v_po_id;

  IF v_received <= 0 THEN
    v_new_status := 'approved';
  ELSIF v_open_lines = 0 THEN
    v_new_status := 'received';
  ELSE
    v_new_status := 'partially_received';
  END IF;

  -- Only move POs already in the receiving flow; never resurrect a
  -- draft/pending/cancelled PO, and don't downgrade 'ordered' to 'approved'
  -- when nothing has been received yet.
  UPDATE public.purchase_orders
  SET status = v_new_status
  WHERE id = v_po_id
    AND status IN ('approved', 'ordered', 'partially_received', 'received')
    AND status <> v_new_status
    AND NOT (v_new_status = 'approved' AND status = 'ordered');

  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_zz_recalc_po_receipt_status
  AFTER INSERT OR UPDATE OR DELETE ON public.grn_items
  FOR EACH ROW
  EXECUTE FUNCTION public.recalc_po_receipt_status();

-- ============================================================
-- 2. Reject over-receipt
-- ============================================================
-- Runs after trigger_update_po_item_received has folded this row into
-- purchase_order_items.quantity_received, so the check sees the cumulative
-- total across all GRNs for the line.
CREATE OR REPLACE FUNCTION public.validate_po_item_over_receipt()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_ordered NUMERIC;
  v_received NUMERIC;
BEGIN
  IF NEW.po_item_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT quantity, COALESCE(quantity_received, 0)
  INTO v_ordered, v_received
  FROM public.purchase_order_items
  WHERE id = NEW.po_item_id;

  IF v_received > v_ordered + 0.001 THEN
    RAISE EXCEPTION
      'Over-receipt on PO line: total received % exceeds ordered quantity %',
      v_received, v_ordered;
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_validate_po_item_over_receipt
  AFTER INSERT OR UPDATE ON public.grn_items
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_po_item_over_receipt();

-- ============================================================
-- 3. Backfill POs closed too early
-- ============================================================
UPDATE public.purchase_orders po
SET status = 'partially_received'
WHERE po.status = 'received'
  AND EXISTS (
    SELECT 1 FROM public.purchase_order_items poi
    WHERE poi.order_id = po.id
      AND COALESCE(poi.quantity_received, 0) + 0.001 < poi.quantity
  )
  AND EXISTS (
    SELECT 1 FROM public.purchase_order_items poi
    WHERE poi.order_id = po.id
      AND COALESCE(poi.quantity_received, 0) > 0
  );
