-- ============================================================
-- Bridge procurement Items ↔ production Consumption Raw Materials
--
-- The procurement side (purchase_orders → goods_receipt_notes) picks
-- from public.items. The production side (consumption_bom, stock
-- closing, production_entry) uses public.consumption_raw_materials.
-- Without a bridge the same physical material has to be entered in
-- both masters and they drift over time.
--
-- This migration:
--   1. Adds a nullable, unique FK column on items pointing at a
--      consumption_raw_material row (one-to-one when set).
--   2. Backfills: for every consumption_raw_material that does not
--      yet have a paired items row, create one (category=raw_material,
--      unit_price = cost_value, uom mapped by unit text) and link it.
-- ============================================================

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS consumption_raw_material_id UUID
  REFERENCES public.consumption_raw_materials(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_items_consumption_rm_unique
  ON public.items(consumption_raw_material_id)
  WHERE consumption_raw_material_id IS NOT NULL;

DO $$
DECLARE
  r RECORD;
  v_uom_id UUID;
  v_code TEXT;
BEGIN
  FOR r IN
    SELECT rm.id, rm.code, rm.name, rm.unit, rm.cost_value
      FROM public.consumption_raw_materials rm
     WHERE rm.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM public.items i WHERE i.consumption_raw_material_id = rm.id
       )
  LOOP
    -- Best-effort UOM resolution by the consumption.unit text
    v_uom_id := NULL;
    SELECT id INTO v_uom_id FROM public.units_of_measure
     WHERE LOWER(name) = CASE LOWER(r.unit)
                           WHEN 'kg'      THEN 'kilogram'
                           WHEN 'kgs'     THEN 'kilogram'
                           WHEN 'ltr'     THEN 'liter'
                           WHEN 'litre'   THEN 'liter'
                           WHEN 'liters'  THEN 'liter'
                           WHEN 'litres'  THEN 'liter'
                           ELSE LOWER(r.unit)
                         END
     LIMIT 1;

    -- Use the RM code as-is if free; otherwise prefix with RM- to avoid the
    -- items_code_key unique-constraint clash with whatever already exists.
    v_code := r.code;
    IF EXISTS (SELECT 1 FROM public.items WHERE code = v_code) THEN
      v_code := 'RM-' || r.code;
    END IF;

    INSERT INTO public.items
      (code, name, category, uom_id, unit_price,
       is_inventory_item, is_active, consumption_raw_material_id)
    VALUES
      (v_code, r.name, 'raw_material', v_uom_id, r.cost_value,
       true, true, r.id);
  END LOOP;
END $$;
