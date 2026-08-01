-- ============================================================================
-- Step 5 (guardrail) of the Production → Material Consumption link
-- ----------------------------------------------------------------------------
-- Once a consumption product is mapped to a production grade, its production
-- quantities come exclusively from posted production entries. Until now that
-- was only true eventually: a mapped product with nothing posted yet for the
-- day still accepted manual input, which the sync would later overwrite
-- without warning.
--
-- This trigger closes the gap at the database level: manual writes to
-- consumption_production_entry are rejected for mapped products on or after
-- the sync cutover. The sync itself writes with synced_from_production = true
-- and passes; the same test stops a synced row's flag from being cleared by
-- a direct write. Pre-cutover history and unmapped products stay writable.
-- The UI mirrors this by disabling those inputs outright.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_consumption_manual_entry_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mapped boolean;
BEGIN
  IF NEW.synced_from_production
     OR NEW.entry_date < public.consumption_production_sync_cutover() THEN
    RETURN NEW;
  END IF;

  SELECT grade_id IS NOT NULL INTO v_mapped
    FROM public.consumption_products
   WHERE id = NEW.product_id;

  IF v_mapped THEN
    RAISE EXCEPTION 'This product is linked to production. Its quantities sync automatically from posted production entries — post the entry in the production module instead.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consumption_manual_entry_guard ON public.consumption_production_entry;
CREATE TRIGGER trg_consumption_manual_entry_guard
  BEFORE INSERT OR UPDATE ON public.consumption_production_entry
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_consumption_manual_entry_guard();
