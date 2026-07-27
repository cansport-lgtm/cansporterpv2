-- ============================================================================
-- Material Consumption receipts come from Accounting/Purchase GRNs
-- ----------------------------------------------------------------------------
-- Receipts in the Material Consumption module were typed by hand into
-- consumption_stock_closing.receipt_quantity, drifting from what Purchase /
-- Accounting actually received via Goods Receipt Notes. From the cutover date
-- below, the GRN is the single source of truth for receipts:
--
--   grn_items.item_id -> items.consumption_raw_material_id
--                     -> consumption_raw_materials.id
--
-- QC note: raw-material POs must pass quality inspection BEFORE a GRN can be
-- created (trg_enforce_qc_before_grn), so grn_items.quantity_received is
-- already the accepted quantity.
--
-- This migration:
--   1. v_consumption_grn_receipts  — completed-GRN receipts per raw material
--      per day (quantity, value, GRN count). Read live by the UI.
--   2. v_consumption_grn_unmapped  — completed raw-material GRN lines that do
--      NOT resolve to a consumption raw material, so they can be surfaced
--      instead of silently vanishing from consumption reports.
--   3. Triggers that keep consumption_stock_closing.receipt_quantity equal to
--      the GRN-derived value for closing dates on/after the cutover, both when
--      a closing row is saved and when GRN data changes later. The generated
--      actual_consumption column and every existing report stay correct.
--      Rows before the cutover keep their manual history untouched.
-- ============================================================================

-- Cutover: manual receipt history before this date is preserved verbatim.
CREATE OR REPLACE FUNCTION public.consumption_grn_cutover()
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$ SELECT DATE '2026-07-27' $$;

-- 1. Daily GRN receipts per consumption raw material ------------------------
CREATE OR REPLACE VIEW public.v_consumption_grn_receipts
WITH (security_invoker = on) AS
SELECT
  i.consumption_raw_material_id       AS raw_material_id,
  g.receipt_date,
  SUM(gi.quantity_received)           AS receipt_quantity,
  SUM(gi.amount)                      AS receipt_amount,
  COUNT(DISTINCT g.id)                AS grn_count
FROM public.grn_items gi
JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
JOIN public.items i               ON i.id = gi.item_id
WHERE g.status = 'completed'
  AND i.consumption_raw_material_id IS NOT NULL
  AND gi.quantity_received > 0
GROUP BY i.consumption_raw_material_id, g.receipt_date;

-- 2. Raw-material GRN lines that cannot be attributed to a raw material -----
CREATE OR REPLACE VIEW public.v_consumption_grn_unmapped
WITH (security_invoker = on) AS
SELECT
  g.id            AS grn_id,
  g.grn_number,
  g.receipt_date,
  gi.id           AS grn_item_id,
  gi.description,
  gi.quantity_received,
  gi.amount
FROM public.grn_items gi
JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
JOIN public.purchase_orders po    ON po.id = g.purchase_order_id
LEFT JOIN public.items i          ON i.id = gi.item_id
WHERE g.status = 'completed'
  AND po.category = 'raw_material'
  AND gi.quantity_received > 0
  AND (gi.item_id IS NULL OR i.consumption_raw_material_id IS NULL);

-- 3. Keep consumption_stock_closing.receipt_quantity in sync ----------------

-- GRN-derived receipt for one material on one date.
CREATE OR REPLACE FUNCTION public.consumption_grn_receipt_qty(p_material uuid, p_date date)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(gi.quantity_received), 0)
    FROM public.grn_items gi
    JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
    JOIN public.items i               ON i.id = gi.item_id
   WHERE g.status = 'completed'
     AND g.receipt_date = p_date
     AND i.consumption_raw_material_id = p_material;
$$;

-- Saving a closing row on/after the cutover always takes the GRN value;
-- adjustments belong in the GRN, not in the closing sheet.
CREATE OR REPLACE FUNCTION public.set_closing_receipt_from_grn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.closing_date >= public.consumption_grn_cutover() THEN
    NEW.receipt_quantity := public.consumption_grn_receipt_qty(NEW.raw_material_id, NEW.closing_date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_closing_receipt_from_grn ON public.consumption_stock_closing;
CREATE TRIGGER trg_closing_receipt_from_grn
  BEFORE INSERT OR UPDATE ON public.consumption_stock_closing
  FOR EACH ROW
  EXECUTE FUNCTION public.set_closing_receipt_from_grn();

-- Refresh an already-saved closing row when GRN data changes afterwards.
CREATE OR REPLACE FUNCTION public.resync_closing_receipt(p_material uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_material IS NULL OR p_date IS NULL OR p_date < public.consumption_grn_cutover() THEN
    RETURN;
  END IF;
  UPDATE public.consumption_stock_closing
     SET receipt_quantity = public.consumption_grn_receipt_qty(p_material, p_date),
         updated_at = now()
   WHERE raw_material_id = p_material
     AND closing_date = p_date;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_grn_item_change_resync_closing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date     date;
  v_material uuid;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT g.receipt_date INTO v_date FROM public.goods_receipt_notes g WHERE g.id = NEW.grn_id;
    SELECT i.consumption_raw_material_id INTO v_material FROM public.items i WHERE i.id = NEW.item_id;
    PERFORM public.resync_closing_receipt(v_material, v_date);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT g.receipt_date INTO v_date FROM public.goods_receipt_notes g WHERE g.id = OLD.grn_id;
    SELECT i.consumption_raw_material_id INTO v_material FROM public.items i WHERE i.id = OLD.item_id;
    PERFORM public.resync_closing_receipt(v_material, v_date);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_grn_item_resync_closing ON public.grn_items;
CREATE TRIGGER trg_grn_item_resync_closing
  AFTER INSERT OR UPDATE OR DELETE ON public.grn_items
  FOR EACH ROW
  EXECUTE FUNCTION public.on_grn_item_change_resync_closing();

CREATE OR REPLACE FUNCTION public.on_grn_change_resync_closing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status
     AND OLD.receipt_date IS NOT DISTINCT FROM NEW.receipt_date THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT DISTINCT i.consumption_raw_material_id AS material
      FROM public.grn_items gi
      JOIN public.items i ON i.id = gi.item_id
     WHERE gi.grn_id = NEW.id
       AND i.consumption_raw_material_id IS NOT NULL
  LOOP
    PERFORM public.resync_closing_receipt(r.material, OLD.receipt_date);
    PERFORM public.resync_closing_receipt(r.material, NEW.receipt_date);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_grn_resync_closing ON public.goods_receipt_notes;
CREATE TRIGGER trg_grn_resync_closing
  AFTER UPDATE OF status, receipt_date ON public.goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.on_grn_change_resync_closing();

-- One-time alignment of any closing rows already saved on/after the cutover.
UPDATE public.consumption_stock_closing c
   SET receipt_quantity = public.consumption_grn_receipt_qty(c.raw_material_id, c.closing_date)
 WHERE c.closing_date >= public.consumption_grn_cutover()
   AND c.receipt_quantity IS DISTINCT FROM public.consumption_grn_receipt_qty(c.raw_material_id, c.closing_date);
