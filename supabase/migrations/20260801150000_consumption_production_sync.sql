-- ============================================================================
-- Step 4 of the Production → Material Consumption link: the auto-sync
-- ----------------------------------------------------------------------------
-- Posting a production entry now writes the consumption module's production
-- data automatically. The pipeline the earlier steps set up:
--
--   production_entries (posted)                                   [step 2]
--     → consumption_product_for_production(grade, department)     [step 1]
--     → v_consumption_production_from_production                  [step 3]
--         one row per (date, product): SUM(quantity_ok) × factor
--     → consumption_production_entry (upserted here)              [step 4]
--         → existing triggers take it from there (intermediate
--           receipts, stock closing resync — 20260728120000)
--
-- Rules, mirroring the GRN → receipts sync (20260727120000):
--   • Cutover date: rows before it are never touched, so manual history
--     stays verbatim. From the cutover on, posted production is authoritative
--     for mapped products — a manual row for the same (date, product) is
--     overwritten on purpose; corrections belong in the production module.
--   • Synced rows are flagged (synced_from_production) so the UI shows them
--     read-only and the sync never deletes a manually-entered row.
--   • Unposting / remapping recomputes the affected day totals; a day left
--     with no posted production loses its synced row (manual rows survive).
-- ============================================================================

-- Cutover: entries before this date stay manual and untouched.
CREATE OR REPLACE FUNCTION public.consumption_production_sync_cutover()
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$ SELECT DATE '2026-08-01' $$;

ALTER TABLE public.consumption_production_entry
  ADD COLUMN IF NOT EXISTS synced_from_production boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.consumption_production_entry.synced_from_production IS
  'True when this row is maintained by the production sync (posted production_entries aggregated per day). Such rows are read-only in the UI and overwritten/removed as posted production changes.';

-- Recompute one (date, product) from the step-3 view and make
-- consumption_production_entry match it.
CREATE OR REPLACE FUNCTION public.consumption_resync_production_day(p_date date, p_product uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_qty numeric;
  v_unit varchar;
BEGIN
  IF p_product IS NULL OR p_date IS NULL
     OR p_date < public.consumption_production_sync_cutover() THEN
    RETURN;
  END IF;

  SELECT converted_quantity, product_unit INTO v_qty, v_unit
    FROM public.v_consumption_production_from_production
   WHERE entry_date = p_date AND product_id = p_product;

  IF FOUND THEN
    INSERT INTO public.consumption_production_entry
      (entry_date, product_id, quantity_produced, unit, synced_from_production)
    VALUES (p_date, p_product, v_qty, COALESCE(v_unit, 'pcs'), true)
    ON CONFLICT (entry_date, product_id) DO UPDATE
      SET quantity_produced      = EXCLUDED.quantity_produced,
          unit                   = EXCLUDED.unit,
          synced_from_production = true,
          updated_at             = now();
  ELSE
    DELETE FROM public.consumption_production_entry
     WHERE entry_date = p_date
       AND product_id = p_product
       AND synced_from_production;
  END IF;
END;
$$;

-- Any change to a production entry refreshes the day totals it touches.
-- OLD and NEW are both resynced so date/grade edits and unposting clean up
-- after themselves; the posting lock (step 2) keeps posted data immutable,
-- so in practice this fires on post, unpost, and draft churn (a no-op for
-- draft-only days, since the view only sees posted entries).
CREATE OR REPLACE FUNCTION public.on_production_entry_sync_consumption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.consumption_resync_production_day(
      NEW.entry_date,
      public.consumption_product_for_production(NEW.grade_id, NEW.department_id));
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.consumption_resync_production_day(
      OLD.entry_date,
      public.consumption_product_for_production(OLD.grade_id, OLD.department_id));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_entry_sync_consumption ON public.production_entries;
CREATE TRIGGER trg_production_entry_sync_consumption
  AFTER INSERT OR UPDATE OR DELETE ON public.production_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.on_production_entry_sync_consumption();

-- Remapping a product (grade, department, factor, active flag) moves posted
-- production between products, so refresh every affected (date, product):
-- all products mapped to the old or new grade, over all posted dates of those
-- grades, plus this product's own synced rows (covers unlinking).
CREATE OR REPLACE FUNCTION public.on_consumption_product_mapping_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF OLD.grade_id IS NOT DISTINCT FROM NEW.grade_id
     AND OLD.production_department_id IS NOT DISTINCT FROM NEW.production_department_id
     AND OLD.production_conversion_factor IS NOT DISTINCT FROM NEW.production_conversion_factor
     AND OLD.is_active IS NOT DISTINCT FROM NEW.is_active THEN
    RETURN NULL;
  END IF;

  FOR r IN
    SELECT DISTINCT pe.entry_date, cp.id AS product_id
      FROM public.production_entries pe
      JOIN public.consumption_products cp
        ON cp.grade_id IN (OLD.grade_id, NEW.grade_id)
     WHERE pe.status = 'Posted'
       AND pe.entry_date >= public.consumption_production_sync_cutover()
       AND pe.grade_id IN (OLD.grade_id, NEW.grade_id)
  LOOP
    PERFORM public.consumption_resync_production_day(r.entry_date, r.product_id);
  END LOOP;

  FOR r IN
    SELECT entry_date FROM public.consumption_production_entry
     WHERE product_id = NEW.id
       AND synced_from_production
       AND entry_date >= public.consumption_production_sync_cutover()
  LOOP
    PERFORM public.consumption_resync_production_day(r.entry_date, NEW.id);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_consumption_product_mapping_resync ON public.consumption_products;
CREATE TRIGGER trg_consumption_product_mapping_resync
  AFTER UPDATE OF grade_id, production_department_id, production_conversion_factor, is_active
  ON public.consumption_products
  FOR EACH ROW
  EXECUTE FUNCTION public.on_consumption_product_mapping_change();

-- One-time backfill: sync everything already posted since the cutover.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT entry_date, product_id
      FROM public.v_consumption_production_from_production
     WHERE entry_date >= public.consumption_production_sync_cutover()
  LOOP
    PERFORM public.consumption_resync_production_day(r.entry_date, r.product_id);
  END LOOP;
END $$;
