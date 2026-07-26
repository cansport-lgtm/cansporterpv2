-- ============================================================
-- Link raw-material categorization to the Items master
--
-- consumption_raw_materials.category (used by the consumption module's
-- dashboards, stock closing and reports to group materials) was never
-- connected to the Items master: items.category is the purchase-type enum
-- ('raw_material', 'office_supplies', ...), not the raw-material category,
-- and the Items -> consumption_raw_materials sync trigger deliberately left
-- the category column untouched. Since the Raw Materials page became a
-- read-only mirror, there was no way to categorize a raw material at all.
--
-- This migration adds items.raw_material_category_id referencing the
-- consumption_categories master, makes the sync trigger propagate the chosen
-- category's name into consumption_raw_materials.category, and backfills the
-- new column from the categories already stored on the mirror rows. It also
-- propagates category renames into the mirror so grouping never goes stale.
-- ============================================================

-- 1) New column on the Items master.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS raw_material_category_id uuid
  REFERENCES public.consumption_categories(id) ON DELETE SET NULL;

-- 2) Backfill.
-- 2a) Make sure every category name already in use on mirror rows exists in
--     the consumption_categories master (same seeding rule used when the
--     master was introduced).
INSERT INTO public.consumption_categories (name, code)
SELECT DISTINCT category, UPPER(REPLACE(category, ' ', '_'))
  FROM public.consumption_raw_materials
 WHERE category IS NOT NULL AND category <> ''
ON CONFLICT (name) DO NOTHING;

-- 2b) Reverse-link: items inherit the category their mirror row already has.
UPDATE public.items i
   SET raw_material_category_id = cc.id
  FROM public.consumption_raw_materials crm
  JOIN public.consumption_categories cc ON cc.name = crm.category
 WHERE i.consumption_raw_material_id = crm.id
   AND i.raw_material_category_id IS NULL;

-- 3) Sync trigger now also carries the category name into the mirror.
--    The Items master is authoritative: a NULL category clears the mirror's.
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
      (code, name, unit, cost_value, description, is_active, category)
    VALUES
      (NEW.code, NEW.name, v_unit, NEW.unit_price, NEW.description, coalesce(NEW.is_active, true), v_category)
    RETURNING id INTO v_crm_id;
  ELSE
    UPDATE public.consumption_raw_materials
       SET code        = NEW.code,
           name        = NEW.name,
           unit        = v_unit,
           cost_value  = NEW.unit_price,
           description = NEW.description,
           is_active   = coalesce(NEW.is_active, true),
           category    = v_category,
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
  BEFORE INSERT OR UPDATE OF code, name, category, uom_id, unit_price, description, is_active, consumption_raw_material_id, raw_material_category_id
  ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_item_to_consumption_rm();

-- 4) Renaming a category in the master updates the name stored on mirror
--    rows, so report grouping follows the rename instead of going stale.
CREATE OR REPLACE FUNCTION public.sync_consumption_category_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.consumption_raw_materials
       SET category = NEW.name, updated_at = now()
     WHERE category = OLD.name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_consumption_category_rename ON public.consumption_categories;
CREATE TRIGGER trg_sync_consumption_category_rename
  AFTER UPDATE OF name ON public.consumption_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_consumption_category_rename();
