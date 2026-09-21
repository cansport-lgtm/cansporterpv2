-- ============================================================
-- Raw material value-tier classification: HP / MP / CM
--
-- The business classifies raw materials into three value tiers for
-- reporting: High Value (HP), Medium Value (MP), Customer Provided (CM).
-- This is a fixed, independent classification — distinct from the free-form
-- Category Master (consumption_categories) and from items.category (the
-- purchase-type enum) — so it gets its own enum + column on the Items
-- master, and is mirrored into consumption_raw_materials the same way
-- raw_material_category_id already is (see 20260726120000).
--
-- The field is optional: existing items are left unclassified until a user
-- tags them, and reports treat a NULL value_category as "Unclassified".
-- ============================================================

CREATE TYPE public.raw_material_value_category AS ENUM (
  'high_value',
  'medium_value',
  'customer_provided'
);

-- 1) New column on the Items master (source of truth).
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS raw_material_value_category public.raw_material_value_category;

-- 2) Mirror column on the consumption module's raw-material list.
ALTER TABLE public.consumption_raw_materials
  ADD COLUMN IF NOT EXISTS value_category public.raw_material_value_category;

-- 3) Sync trigger now also carries the value category into the mirror.
CREATE OR REPLACE FUNCTION public.sync_item_to_consumption_rm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit     text;
  v_crm_id   uuid;
  v_category text;
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

  -- Resolve the raw-material category name (mirror stores the name as text).
  SELECT c.name INTO v_category
    FROM public.consumption_categories c
   WHERE c.id = NEW.raw_material_category_id;

  -- Resolve the mirror row: existing link, else match by code, else create.
  v_crm_id := NEW.consumption_raw_material_id;
  IF v_crm_id IS NULL THEN
    SELECT id INTO v_crm_id FROM public.consumption_raw_materials WHERE code = NEW.code LIMIT 1;
  END IF;

  IF v_crm_id IS NULL THEN
    INSERT INTO public.consumption_raw_materials
      (code, name, unit, cost_value, description, is_active, category, value_category)
    VALUES
      (NEW.code, NEW.name, v_unit, NEW.unit_price, NEW.description, coalesce(NEW.is_active, true), v_category, NEW.raw_material_value_category)
    RETURNING id INTO v_crm_id;
  ELSE
    UPDATE public.consumption_raw_materials
       SET code           = NEW.code,
           name           = NEW.name,
           unit           = v_unit,
           cost_value     = NEW.unit_price,
           description    = NEW.description,
           is_active      = coalesce(NEW.is_active, true),
           category       = v_category,
           value_category = NEW.raw_material_value_category,
           updated_at     = now()
     WHERE id = v_crm_id;
  END IF;

  -- Link the item to its mirror (BEFORE trigger: safe to mutate NEW).
  NEW.consumption_raw_material_id := v_crm_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_item_to_consumption_rm ON public.items;
CREATE TRIGGER trg_sync_item_to_consumption_rm
  BEFORE INSERT OR UPDATE OF code, name, category, uom_id, unit_price, description, is_active, consumption_raw_material_id, raw_material_category_id, raw_material_value_category
  ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_item_to_consumption_rm();
