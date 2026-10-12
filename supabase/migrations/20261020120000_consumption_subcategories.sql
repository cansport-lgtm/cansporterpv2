-- ============================================================
-- Raw-material sub-categories
--
-- Adds a second classification level under the Category Master
-- (consumption_categories). Sub-categories live in their own master
-- (consumption_subcategories), are picked on the Items master
-- (items.raw_material_subcategory_id) and mirrored by name into
-- consumption_raw_materials.subcategory by the existing sync trigger, the same
-- way the category already is (see 20260726120000).
--
-- The field is optional: existing materials stay valid without one.
-- ============================================================

-- 1) Sub-Category Master.
CREATE TABLE IF NOT EXISTS public.consumption_subcategories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.consumption_categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumption_subcategories_category_name_key UNIQUE (category_id, name)
);

CREATE INDEX IF NOT EXISTS idx_consumption_subcategories_category
  ON public.consumption_subcategories(category_id);

ALTER TABLE public.consumption_subcategories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all access to consumption_subcategories" ON public.consumption_subcategories;
CREATE POLICY "Allow all access to consumption_subcategories"
  ON public.consumption_subcategories FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_consumption_subcategories_updated_at ON public.consumption_subcategories;
CREATE TRIGGER update_consumption_subcategories_updated_at
  BEFORE UPDATE ON public.consumption_subcategories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Items master (source of truth) + mirror column.
ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS raw_material_subcategory_id uuid
  REFERENCES public.consumption_subcategories(id) ON DELETE SET NULL;

ALTER TABLE public.consumption_raw_materials
  ADD COLUMN IF NOT EXISTS subcategory text;

-- 3) Sync trigger now also carries the sub-category name into the mirror,
--    and rejects a sub-category that does not belong to the item's category.
CREATE OR REPLACE FUNCTION public.sync_item_to_consumption_rm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_unit            text;
  v_crm_id          uuid;
  v_category        text;
  v_subcategory     text;
  v_sub_category_id uuid;
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

  -- Resolve the sub-category; it must belong to the chosen category.
  IF NEW.raw_material_subcategory_id IS NOT NULL THEN
    SELECT s.name, s.category_id INTO v_subcategory, v_sub_category_id
      FROM public.consumption_subcategories s
     WHERE s.id = NEW.raw_material_subcategory_id;
    IF v_sub_category_id IS DISTINCT FROM NEW.raw_material_category_id THEN
      RAISE EXCEPTION 'Sub-category "%" does not belong to the selected raw material category', v_subcategory;
    END IF;
  END IF;

  -- Resolve the mirror row: existing link, else match by code, else create.
  v_crm_id := NEW.consumption_raw_material_id;
  IF v_crm_id IS NULL THEN
    SELECT id INTO v_crm_id FROM public.consumption_raw_materials WHERE code = NEW.code LIMIT 1;
  END IF;

  IF v_crm_id IS NULL THEN
    INSERT INTO public.consumption_raw_materials
      (code, name, unit, cost_value, description, is_active, category, subcategory, value_category)
    VALUES
      (NEW.code, NEW.name, v_unit, NEW.unit_price, NEW.description, coalesce(NEW.is_active, true), v_category, v_subcategory, NEW.raw_material_value_category)
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
           subcategory    = v_subcategory,
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
  BEFORE INSERT OR UPDATE OF code, name, category, uom_id, unit_price, description, is_active, consumption_raw_material_id, raw_material_category_id, raw_material_subcategory_id, raw_material_value_category
  ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_item_to_consumption_rm();

-- 4) Renaming a sub-category updates the name stored on mirror rows.
--    Matches on the item link (names are only unique per category).
CREATE OR REPLACE FUNCTION public.sync_consumption_subcategory_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.consumption_raw_materials crm
       SET subcategory = NEW.name, updated_at = now()
      FROM public.items i
     WHERE i.consumption_raw_material_id = crm.id
       AND i.raw_material_subcategory_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_consumption_subcategory_rename ON public.consumption_subcategories;
CREATE TRIGGER trg_sync_consumption_subcategory_rename
  AFTER UPDATE OF name ON public.consumption_subcategories
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_consumption_subcategory_rename();
