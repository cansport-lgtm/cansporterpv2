-- Rollback for 20261005120000_planning_item_types.sql
-- Drops the WIP / Finished Product classification and the finished-product
-- detail columns from planning_items. Uploaded logo pictures stay in the
-- 'planning-item-logos' bucket (nothing references them afterwards); drop the
-- bucket by hand if it is no longer wanted.

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "planning_item_logos_read" ON storage.objects;
    DROP POLICY IF EXISTS "planning_item_logos_insert" ON storage.objects;
    DROP POLICY IF EXISTS "planning_item_logos_update" ON storage.objects;
    DROP POLICY IF EXISTS "planning_item_logos_delete" ON storage.objects;
  END IF;
END $$;

DROP INDEX IF EXISTS public.idx_planning_items_item_type;
DROP INDEX IF EXISTS public.idx_planning_items_customer;

ALTER TABLE public.planning_items
  DROP CONSTRAINT IF EXISTS planning_items_company_sku_no_customer;

ALTER TABLE public.planning_items
  DROP COLUMN IF EXISTS item_type,
  DROP COLUMN IF EXISTS sku_owner_type,
  DROP COLUMN IF EXISTS customer_id,
  DROP COLUMN IF EXISTS sku_code,
  DROP COLUMN IF EXISTS felt,
  DROP COLUMN IF EXISTS logo_image_path,
  DROP COLUMN IF EXISTS grade_id,
  DROP COLUMN IF EXISTS packing,
  DROP COLUMN IF EXISTS master_packing;
