-- ============================================================================
-- Daily vs. weekly stock closing per raw material
-- ----------------------------------------------------------------------------
-- Some raw materials are counted every day, others only once a week. Weekly
-- materials are posted on Mondays (the entry covers the week ending that
-- Monday) and additionally on the last day of each month so monthly COGS
-- values month-end stock exactly.
--
-- This migration:
--   1. Adds consumption_raw_materials.closing_frequency ('daily' | 'weekly').
--   2. Generalizes the GRN-receipt sync (20260727120000) from "GRNs dated the
--      closing day" to "GRNs since the previous closing row" — for a weekly
--      material posted on Monday that is the whole week's receipts, and daily
--      materials posted daily are unchanged. Missed days self-heal too.
--   3. Keeps rows consistent when GRNs change later (resync now targets the
--      closing row whose period covers the GRN date) and when closing rows
--      are inserted/deleted out of order (the next row's period shifts).
-- ============================================================================

-- 1. Closing frequency ------------------------------------------------------
ALTER TABLE public.consumption_raw_materials
  ADD COLUMN IF NOT EXISTS closing_frequency TEXT NOT NULL DEFAULT 'daily';

ALTER TABLE public.consumption_raw_materials
  DROP CONSTRAINT IF EXISTS consumption_raw_materials_closing_frequency_check;
ALTER TABLE public.consumption_raw_materials
  ADD CONSTRAINT consumption_raw_materials_closing_frequency_check
  CHECK (closing_frequency IN ('daily', 'weekly'));

COMMENT ON COLUMN public.consumption_raw_materials.closing_frequency IS
  'How often stock closing is posted: daily, or weekly (Mondays + last day of month).';

-- 2. Period-based GRN receipt for a closing row -----------------------------
-- Receipts attributed to a closing row = completed-GRN quantities in the
-- window (previous closing date, closing date]. With no prior closing row the
-- window is just the closing day itself (the pre-period behavior).
CREATE OR REPLACE FUNCTION public.consumption_receipt_for_closing(p_material uuid, p_closing_date date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev date;
BEGIN
  SELECT MAX(closing_date) INTO v_prev
    FROM public.consumption_stock_closing
   WHERE raw_material_id = p_material
     AND closing_date < p_closing_date;

  IF v_prev IS NULL THEN
    v_prev := p_closing_date - 1;
  END IF;

  RETURN COALESCE((
    SELECT SUM(gi.quantity_received)
      FROM public.grn_items gi
      JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
      JOIN public.items i               ON i.id = gi.item_id
     WHERE g.status = 'completed'
       AND g.receipt_date > v_prev
       AND g.receipt_date <= p_closing_date
       AND i.consumption_raw_material_id = p_material
  ), 0);
END;
$$;

-- Saving a closing row on/after the cutover takes the period GRN value.
CREATE OR REPLACE FUNCTION public.set_closing_receipt_from_grn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.closing_date >= public.consumption_grn_cutover() THEN
    NEW.receipt_quantity := public.consumption_receipt_for_closing(NEW.raw_material_id, NEW.closing_date);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Resync when GRN data changes: refresh the closing row whose period
--    covers the GRN date (the earliest closing row on/after it).
CREATE OR REPLACE FUNCTION public.resync_closing_receipt(p_material uuid, p_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_covering date;
BEGIN
  IF p_material IS NULL OR p_date IS NULL THEN
    RETURN;
  END IF;

  SELECT MIN(closing_date) INTO v_covering
    FROM public.consumption_stock_closing
   WHERE raw_material_id = p_material
     AND closing_date >= p_date;

  IF v_covering IS NULL OR v_covering < public.consumption_grn_cutover() THEN
    RETURN;
  END IF;

  UPDATE public.consumption_stock_closing
     SET receipt_quantity = public.consumption_receipt_for_closing(p_material, v_covering),
         updated_at = now()
   WHERE raw_material_id = p_material
     AND closing_date = v_covering;
END;
$$;

-- 4. Inserting or deleting a closing row shifts the NEXT row's period --------
CREATE OR REPLACE FUNCTION public.on_closing_row_change_resync_next()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material uuid;
  v_date     date;
  v_next     date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_material := OLD.raw_material_id;
    v_date     := OLD.closing_date;
  ELSE
    v_material := NEW.raw_material_id;
    v_date     := NEW.closing_date;
  END IF;

  SELECT MIN(closing_date) INTO v_next
    FROM public.consumption_stock_closing
   WHERE raw_material_id = v_material
     AND closing_date > v_date;

  IF v_next IS NOT NULL AND v_next >= public.consumption_grn_cutover() THEN
    UPDATE public.consumption_stock_closing
       SET receipt_quantity = public.consumption_receipt_for_closing(v_material, v_next),
           updated_at = now()
     WHERE raw_material_id = v_material
       AND closing_date = v_next;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_closing_row_resync_next ON public.consumption_stock_closing;
CREATE TRIGGER trg_closing_row_resync_next
  AFTER INSERT OR DELETE ON public.consumption_stock_closing
  FOR EACH ROW
  EXECUTE FUNCTION public.on_closing_row_change_resync_next();

-- 5. Re-align post-cutover rows with the period-based value -----------------
UPDATE public.consumption_stock_closing c
   SET receipt_quantity = public.consumption_receipt_for_closing(c.raw_material_id, c.closing_date)
 WHERE c.closing_date >= public.consumption_grn_cutover()
   AND c.receipt_quantity IS DISTINCT FROM public.consumption_receipt_for_closing(c.raw_material_id, c.closing_date);
