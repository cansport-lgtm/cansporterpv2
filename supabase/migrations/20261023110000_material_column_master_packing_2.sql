-- 8th material column: Master Packing 2, at the end, stock-checked, and a
-- customer SKU can choose its own item (like Stamp / Logo and Cartons).
-- Its category is set later on Products / SKUs > Column setup.

INSERT INTO public.product_material_slots (key, label, sort_order, customer_override)
VALUES ('master_packing_2', 'Master Packing 2', 8, true)
ON CONFLICT (key) DO NOTHING;

-- The customer SKU message now lists whichever columns a customer SKU can
-- change, so it stays right after a column is added or renamed.
CREATE OR REPLACE FUNCTION public.product_materials_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slot  public.product_material_slots%ROWTYPE;
  v_item  public.items%ROWTYPE;
  v_prod  public.products%ROWTYPE;
  v_allowed text;
BEGIN
  SELECT * INTO v_slot FROM public.product_material_slots WHERE key = NEW.slot;
  SELECT * INTO v_item FROM public.items WHERE id = NEW.item_id;
  SELECT * INTO v_prod FROM public.products WHERE id = NEW.product_id;

  IF v_item.id IS NULL OR v_item.category IS DISTINCT FROM 'raw_material'::purchase_category THEN
    RAISE EXCEPTION '% must be a Raw Material item from Item Master', v_slot.label;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.item_id IS DISTINCT FROM OLD.item_id THEN
    IF coalesce(v_item.is_active, true) = false THEN
      RAISE EXCEPTION 'Item % is inactive', v_item.name;
    END IF;
    IF v_slot.category_id IS NULL THEN
      RAISE EXCEPTION 'Column % has no category set. Set it in Products / SKUs > Column setup', v_slot.label;
    END IF;
    IF v_item.raw_material_category_id IS DISTINCT FROM v_slot.category_id
       OR (v_slot.subcategory_id IS NOT NULL
           AND v_item.raw_material_subcategory_id IS DISTINCT FROM v_slot.subcategory_id) THEN
      RAISE EXCEPTION 'Item % does not belong to the % column''s category', v_item.name, v_slot.label;
    END IF;
  END IF;

  IF v_prod.owner_type = 'customer' AND v_prod.base_product_id IS NOT NULL
     AND NOT v_slot.customer_override THEN
    SELECT string_agg(s.label, ', ' ORDER BY s.sort_order) INTO v_allowed
      FROM public.product_material_slots s WHERE s.customer_override;
    RAISE EXCEPTION 'Customer SKUs copy % from their base product; only % can be changed',
      v_slot.label, coalesce(v_allowed, 'no column');
  END IF;
  RETURN NEW;
END;
$$;
