-- Close-short for partially received purchase orders
--
-- Sometimes a supplier will never deliver the balance of a PO (item
-- discontinued, order renegotiated, remainder cancelled). A purchase manager
-- can then "close short": mark the PO completed even though received < ordered.
--
--   * New audit columns record who closed the PO short and when.
--   * recalc_po_receipt_status (from 20260908120000) learns to leave a
--     closed-short PO alone, so later GRN edits/deletions on its receipts do
--     not flip it back to 'partially_received'.
--
-- Authorization note: the manager-only restriction is enforced in the app
-- (purchase 'approve' permission = purchase_manager / super_admin), matching
-- how PO approval itself is gated.

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS closed_short_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS closed_short_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_short_reason TEXT;

COMMENT ON COLUMN public.purchase_orders.closed_short_at IS
  'Set when a manager marked the PO completed although received < ordered. While set, receipt-status recalculation leaves the PO untouched.';

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
  -- draft/pending/cancelled PO, don't downgrade 'ordered' to 'approved'
  -- when nothing has been received yet, and leave closed-short POs alone.
  UPDATE public.purchase_orders
  SET status = v_new_status
  WHERE id = v_po_id
    AND closed_short_at IS NULL
    AND status IN ('approved', 'ordered', 'partially_received', 'received')
    AND status <> v_new_status
    AND NOT (v_new_status = 'approved' AND status = 'ordered');

  RETURN NULL;
END;
$$;
