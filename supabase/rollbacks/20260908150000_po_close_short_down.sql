-- Rollback for 20260908150000_po_close_short.sql
-- Restores recalc_po_receipt_status to the 20260908120000 version (no
-- closed-short exemption) and drops the audit columns.

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

  UPDATE public.purchase_orders
  SET status = v_new_status
  WHERE id = v_po_id
    AND status IN ('approved', 'ordered', 'partially_received', 'received')
    AND status <> v_new_status
    AND NOT (v_new_status = 'approved' AND status = 'ordered');

  RETURN NULL;
END;
$$;

ALTER TABLE public.purchase_orders
  DROP COLUMN IF EXISTS closed_short_by,
  DROP COLUMN IF EXISTS closed_short_at,
  DROP COLUMN IF EXISTS closed_short_reason;
