-- ============================================================
-- Material Consumption uses the central Items master for raw materials
--
-- The Material Consumption module (BOM, stock closing, usage reports) and the
-- accounting COGS / production-consumption RPCs all read raw materials from
-- public.consumption_raw_materials. The business wants raw materials to be
-- maintained in ONE place: the central Master Data -> Items master
-- (public.items, category = 'raw_material').
--
-- This migration makes Items the single source of truth by mirroring every
-- raw-material item into consumption_raw_materials and keeping the mirror in
-- sync via a trigger. Identity / costing fields (code, name, unit, cost_value,
-- description, is_active) flow Items -> consumption_raw_materials. Consumption-
-- only attributes (threshold, priority, category) are left untouched.
--
-- It deliberately does NOT change any foreign keys or downstream queries, so
-- existing consumption and accounting logic keeps working unchanged.
-- ============================================================

CREATE OR REPLACE FUNCTION public.sync_item_to_consumption_rm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit   text;
  v_crm_id uuid;
BEGIN
  -- Only raw-material items are mirrored.
  IF NEW.category IS DISTINCT FROM 'raw_material'::purchase_category THEN
    RETURN NEW;
  END IF;

  -- Map the item's unit of measure to the consumption unit text.
  SELECT lower(coalesce(u.symbol, 'kg')) INTO v_unit
    FROM public.units_of_measure u
   WHERE u.id = NEW.uom_id;
  v_unit := coalesce(v_unit, 'kg');
  IF v_unit = 'l' THEN v_unit := 'ltr'; END IF;

  -- Resolve the mirror row: existing link, else match by code, else create.
  v_crm_id := NEW.consumption_raw_material_id;
  IF v_crm_id IS NULL THEN
    SELECT id INTO v_crm_id FROM public.consumption_raw_materials WHERE code = NEW.code LIMIT 1;
  END IF;

  IF v_crm_id IS NULL THEN
    INSERT INTO public.consumption_raw_materials
      (code, name, unit, cost_value, description, is_active)
    VALUES
      (NEW.code, NEW.name, v_unit, NEW.unit_price, NEW.description, coalesce(NEW.is_active, true))
    RETURNING id INTO v_crm_id;
  ELSE
    UPDATE public.consumption_raw_materials
       SET code        = NEW.code,
           name        = NEW.name,
           unit        = v_unit,
           cost_value  = NEW.unit_price,
           description = NEW.description,
           is_active   = coalesce(NEW.is_active, true),
           updated_at  = now()
     WHERE id = v_crm_id;
  END IF;

  -- Link the item to its mirror (BEFORE trigger: safe to mutate NEW).
  NEW.consumption_raw_material_id := v_crm_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_to_consumption_rm ON public.items;
CREATE TRIGGER trg_sync_item_to_consumption_rm
  BEFORE INSERT OR UPDATE OF code, name, category, uom_id, unit_price, description, is_active, consumption_raw_material_id
  ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_item_to_consumption_rm();

-- One-time backfill for existing raw-material items.
DO $$
DECLARE
  r        RECORD;
  v_unit   text;
  v_crm_id uuid;
BEGIN
  FOR r IN
    SELECT i.id, i.code, i.name, i.unit_price, i.description, i.is_active,
           i.consumption_raw_material_id, i.uom_id
      FROM public.items i
     WHERE i.category = 'raw_material'
  LOOP
    SELECT lower(coalesce(u.symbol, 'kg')) INTO v_unit
      FROM public.units_of_measure u WHERE u.id = r.uom_id;
    v_unit := coalesce(v_unit, 'kg');
    IF v_unit = 'l' THEN v_unit := 'ltr'; END IF;

    v_crm_id := r.consumption_raw_material_id;
    IF v_crm_id IS NULL THEN
      SELECT id INTO v_crm_id FROM public.consumption_raw_materials WHERE code = r.code LIMIT 1;
    END IF;

    IF v_crm_id IS NULL THEN
      INSERT INTO public.consumption_raw_materials
        (code, name, unit, cost_value, description, is_active)
      VALUES
        (r.code, r.name, v_unit, r.unit_price, r.description, coalesce(r.is_active, true))
      RETURNING id INTO v_crm_id;
    ELSE
      UPDATE public.consumption_raw_materials
         SET code = r.code, name = r.name, unit = v_unit, cost_value = r.unit_price,
             description = r.description, is_active = coalesce(r.is_active, true), updated_at = now()
       WHERE id = v_crm_id;
    END IF;

    IF r.consumption_raw_material_id IS DISTINCT FROM v_crm_id THEN
      UPDATE public.items SET consumption_raw_material_id = v_crm_id WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
