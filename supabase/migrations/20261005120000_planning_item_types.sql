-- ============================================================================
-- Planning Item Master: WIP vs Finished Product + finished-product details
-- ----------------------------------------------------------------------------
-- planning_items had no way to say whether an item is work-in-process (a
-- department's intermediate output) or a finished, sellable product. Finished
-- products also need the commercial details production works from.
--
-- This migration adds to public.planning_items:
--
--   item_type          'wip' | 'finished'. NULL = not yet classified (existing
--                      rows the backfill below cannot decide); the master asks
--                      for it on every save.
--
--   Finished-product details (meaningful only when item_type = 'finished'):
--   sku_owner_type     'company' (our own product / SKU) | 'customer'
--                      (a customer's private-label SKU).
--   customer_id        the owning customer when sku_owner_type = 'customer'.
--   sku_code           the company SKU or the customer's SKU code.
--   felt               felt specification (type / supplier / colour).
--   logo_image_path    storage path of the logo picture in the
--                      'planning-item-logos' bucket.
--   grade_id           grade from the grades master.
--   packing            unit packing, e.g. "3 balls per can".
--   master_packing     master carton / bag packing, e.g. "6 Dz CTN".
-- ============================================================================

-- 1. Columns ------------------------------------------------------------------
ALTER TABLE public.planning_items
  ADD COLUMN IF NOT EXISTS item_type text
    CHECK (item_type IN ('wip', 'finished')),
  ADD COLUMN IF NOT EXISTS sku_owner_type text
    CHECK (sku_owner_type IN ('company', 'customer')),
  ADD COLUMN IF NOT EXISTS customer_id uuid
    REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sku_code text,
  ADD COLUMN IF NOT EXISTS felt text,
  ADD COLUMN IF NOT EXISTS logo_image_path text,
  ADD COLUMN IF NOT EXISTS grade_id uuid
    REFERENCES public.grades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS packing text,
  ADD COLUMN IF NOT EXISTS master_packing text;

-- A company SKU never belongs to a customer.
ALTER TABLE public.planning_items
  DROP CONSTRAINT IF EXISTS planning_items_company_sku_no_customer;
ALTER TABLE public.planning_items
  ADD CONSTRAINT planning_items_company_sku_no_customer
    CHECK (sku_owner_type IS DISTINCT FROM 'company' OR customer_id IS NULL);

COMMENT ON COLUMN public.planning_items.item_type IS
  'wip = work-in-process output of a department; finished = finished, sellable product. NULL = not yet classified.';
COMMENT ON COLUMN public.planning_items.sku_owner_type IS
  'Finished products only: company (our own product / SKU) or customer (private-label SKU owned by customer_id).';
COMMENT ON COLUMN public.planning_items.customer_id IS
  'Finished products only: owning customer of a customer SKU. Must be NULL for a company SKU.';
COMMENT ON COLUMN public.planning_items.sku_code IS
  'Finished products only: the company SKU or the customer''s SKU code.';
COMMENT ON COLUMN public.planning_items.felt IS
  'Finished products only: felt specification (type / supplier / colour).';
COMMENT ON COLUMN public.planning_items.logo_image_path IS
  'Finished products only: storage path of the logo picture in the planning-item-logos bucket.';
COMMENT ON COLUMN public.planning_items.grade_id IS
  'Finished products only: grade from the grades master.';
COMMENT ON COLUMN public.planning_items.packing IS
  'Finished products only: unit packing, e.g. "3 balls per can".';
COMMENT ON COLUMN public.planning_items.master_packing IS
  'Finished products only: master carton / bag packing, e.g. "6 Dz CTN".';

CREATE INDEX IF NOT EXISTS idx_planning_items_item_type
  ON public.planning_items(item_type);
CREATE INDEX IF NOT EXISTS idx_planning_items_customer
  ON public.planning_items(customer_id)
  WHERE customer_id IS NOT NULL;

-- 2. Backfill what can be inferred -------------------------------------------
-- An item that a sales product is dispatched from is finished goods, and so is
-- an item in a held-stock category (CPA / leak / rejection / lot are finished
-- goods kept apart from sellable stock). Everything else stays NULL for the
-- planning team to classify in the master.
UPDATE public.planning_items pi
   SET item_type = 'finished'
 WHERE pi.item_type IS NULL
   AND (
     EXISTS (SELECT 1 FROM public.products p WHERE p.planning_item_id = pi.id)
     OR pi.stock_category <> 'standard'
   );

-- 3. Logo picture bucket -----------------------------------------------------
-- Public read so the master and reports can show the picture; writes are open
-- like the other photo buckets because the app signs in with its own
-- app_users table, not Supabase Auth.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('planning-item-logos', 'planning-item-logos', true)
    ON CONFLICT (id) DO NOTHING;

    DROP POLICY IF EXISTS "planning_item_logos_read" ON storage.objects;
    CREATE POLICY "planning_item_logos_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'planning-item-logos');

    DROP POLICY IF EXISTS "planning_item_logos_insert" ON storage.objects;
    CREATE POLICY "planning_item_logos_insert" ON storage.objects
      FOR INSERT WITH CHECK (bucket_id = 'planning-item-logos');

    DROP POLICY IF EXISTS "planning_item_logos_update" ON storage.objects;
    CREATE POLICY "planning_item_logos_update" ON storage.objects
      FOR UPDATE USING (bucket_id = 'planning-item-logos');

    DROP POLICY IF EXISTS "planning_item_logos_delete" ON storage.objects;
    CREATE POLICY "planning_item_logos_delete" ON storage.objects
      FOR DELETE USING (bucket_id = 'planning-item-logos');
  END IF;
END $$;
