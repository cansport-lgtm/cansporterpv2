-- ============================================================
-- Product materials + raw-material stock check on confirmed orders
--
-- 1. products.color (label only, no stock check).
-- 2. product_material_slots: the 7 stock-checked columns on Products / SKUs
--    (Felt, Stamp / Logo, Packing Roll, Theli, Bags, Sleeve, Cartons) and the
--    raw-material category / sub-category each column's dropdown lists.
-- 3. product_materials: one item per product per column, quantity per dozen
--    and wastage %. Units always come from the item (Item Master).
--    Customer SKUs with a base product copy the base product's materials and
--    may only set their own Stamp / Logo and Cartons.
-- 4. consumption_categories.requires_subcategory (Packing Material and
--    Master Packing): items in those categories must carry a sub-category.
-- 5. Stock now = latest Stock Closing count + completed GRNs received after
--    that count. Minimum / maximum come from items.min_stock / max_stock.
-- 6. material_checks + material_check_lines: a saved snapshot each time a
--    sales order is confirmed, a distributor order is approved, or the lines
--    of such an order change. Problems notify Store, Purchase and Admin with a
--    red ('error') notification. The system only SUGGESTS quantities to buy;
--    it never creates a purchase order or requisition and never blocks.
-- 7. Daily jobs: 9:00 AM morning summary, 6:00 PM stock-count reminder.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Color label on products
-- ------------------------------------------------------------
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS color text;

-- ------------------------------------------------------------
-- 2. Columns ("slots") and their category mapping
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_material_slots (
  key text PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL,
  category_id uuid REFERENCES public.consumption_categories(id) ON DELETE SET NULL,
  subcategory_id uuid REFERENCES public.consumption_subcategories(id) ON DELETE SET NULL,
  -- Customer SKUs with a base product may override only these columns.
  customer_override boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.product_material_slots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_product_material_slots ON public.product_material_slots;
CREATE POLICY allow_all_product_material_slots
  ON public.product_material_slots FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.product_material_slots (key, label, sort_order, customer_override) VALUES
  ('felt',         'Felt',         1, false),
  ('stamp_logo',   'Stamp / Logo', 2, true),
  ('packing_roll', 'Packing Roll', 3, false),
  ('theli',        'Theli',        4, false),
  ('bags',         'Bags',         5, false),
  ('sleeve',       'Sleeve',       6, false),
  ('cartons',      'Cartons',      7, true)
ON CONFLICT (key) DO NOTHING;

-- Best-effort first mapping from existing category / sub-category names:
-- a matching sub-category (e.g. Packaging > PVC SLEEVES) wins, else a
-- category with a matching name (e.g. Felt, Stamps, Cartons).
-- Anything not matched stays empty and is set on Products / SKUs → Column setup.
DO $$
DECLARE
  r record;
  v_cat uuid;
  v_sub uuid;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('felt',         ARRAY['%felt%']),
      ('stamp_logo',   ARRAY['%stamp%', '%logo%']),
      ('packing_roll', ARRAY['%packing roll%']),
      ('theli',        ARRAY['%theli%']),
      ('bags',         ARRAY['bag', 'bags', '% bag', '% bags', 'pouch%']),
      ('sleeve',       ARRAY['%sleeve%']),
      ('cartons',      ARRAY['%carton%', 'master packing'])
    ) AS m(key, patterns)
  LOOP
    v_cat := NULL; v_sub := NULL;
    SELECT sc.category_id, sc.id INTO v_cat, v_sub
      FROM public.consumption_subcategories sc
     WHERE coalesce(sc.is_active, true) AND lower(trim(sc.name)) LIKE ANY (r.patterns)
     ORDER BY sc.name LIMIT 1;
    IF v_cat IS NULL THEN
      SELECT c.id INTO v_cat
        FROM public.consumption_categories c
       WHERE coalesce(c.is_active, true) AND lower(trim(c.name)) LIKE ANY (r.patterns)
       ORDER BY c.name LIMIT 1;
    END IF;
    UPDATE public.product_material_slots
       SET category_id = v_cat, subcategory_id = v_sub
     WHERE key = r.key AND category_id IS NULL AND v_cat IS NOT NULL;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. Product materials (+ change log)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.product_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  slot text NOT NULL REFERENCES public.product_material_slots(key) ON UPDATE CASCADE,
  item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  qty_per_dozen numeric(14,4) NOT NULL CHECK (qty_per_dozen > 0),
  wastage_pct numeric(6,2) NOT NULL DEFAULT 0 CHECK (wastage_pct >= 0 AND wastage_pct < 100),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_materials_product_slot_key UNIQUE (product_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_product_materials_item ON public.product_materials(item_id);

ALTER TABLE public.product_materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_product_materials ON public.product_materials;
CREATE POLICY allow_all_product_materials
  ON public.product_materials FOR ALL USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS update_product_materials_updated_at ON public.product_materials;
CREATE TRIGGER update_product_materials_updated_at
  BEFORE UPDATE ON public.product_materials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Guard rails: the item must be an active raw-material item of the column's
-- mapped category / sub-category, and a customer SKU with a base product may
-- only set the columns marked customer_override.
CREATE OR REPLACE FUNCTION public.product_materials_validate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_slot  public.product_material_slots%ROWTYPE;
  v_item  public.items%ROWTYPE;
  v_prod  public.products%ROWTYPE;
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
    RAISE EXCEPTION 'Customer SKUs copy % from their base product; only Stamp / Logo and Cartons can be changed', v_slot.label;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_materials_validate ON public.product_materials;
CREATE TRIGGER trg_product_materials_validate
  BEFORE INSERT OR UPDATE ON public.product_materials
  FOR EACH ROW EXECUTE FUNCTION public.product_materials_validate();

CREATE TABLE IF NOT EXISTS public.product_material_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  slot text NOT NULL,
  action text NOT NULL CHECK (action IN ('added', 'changed', 'removed')),
  old_values jsonb,
  new_values jsonb,
  changed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_material_log_product
  ON public.product_material_log(product_id, changed_at DESC);

ALTER TABLE public.product_material_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_product_material_log ON public.product_material_log;
CREATE POLICY allow_read_product_material_log
  ON public.product_material_log FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.product_materials_log_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    v_old := jsonb_build_object('item_id', OLD.item_id,
      'item_name', (SELECT name FROM public.items WHERE id = OLD.item_id),
      'qty_per_dozen', OLD.qty_per_dozen, 'wastage_pct', OLD.wastage_pct);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    v_new := jsonb_build_object('item_id', NEW.item_id,
      'item_name', (SELECT name FROM public.items WHERE id = NEW.item_id),
      'qty_per_dozen', NEW.qty_per_dozen, 'wastage_pct', NEW.wastage_pct);
  END IF;

  IF TG_OP = 'UPDATE' AND v_old = v_new THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.product_material_log (product_id, slot, action, old_values, new_values, changed_by)
  VALUES (
    coalesce(NEW.product_id, OLD.product_id),
    coalesce(NEW.slot, OLD.slot),
    CASE TG_OP WHEN 'INSERT' THEN 'added' WHEN 'UPDATE' THEN 'changed' ELSE 'removed' END,
    v_old, v_new,
    CASE WHEN TG_OP = 'DELETE' THEN OLD.updated_by ELSE NEW.updated_by END
  );
  RETURN coalesce(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_product_materials_log ON public.product_materials;
CREATE TRIGGER trg_product_materials_log
  AFTER INSERT OR UPDATE OR DELETE ON public.product_materials
  FOR EACH ROW EXECUTE FUNCTION public.product_materials_log_change();

-- Materials each product actually uses: its own rows, and for a customer SKU
-- with a base product the base product's rows for every column it does not
-- set itself.
CREATE OR REPLACE VIEW public.v_product_materials_effective
WITH (security_invoker = on) AS
SELECT pm.product_id, pm.slot, pm.item_id, pm.qty_per_dozen, pm.wastage_pct, false AS inherited
  FROM public.product_materials pm
UNION ALL
SELECT p.id, bm.slot, bm.item_id, bm.qty_per_dozen, bm.wastage_pct, true
  FROM public.products p
  JOIN public.product_materials bm ON bm.product_id = p.base_product_id
 WHERE p.owner_type = 'customer'
   AND p.base_product_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.product_materials own
                    WHERE own.product_id = p.id AND own.slot = bm.slot);

-- ------------------------------------------------------------
-- 4. Sub-category required for Packing Material / Master Packing
-- ------------------------------------------------------------
ALTER TABLE public.consumption_categories
  ADD COLUMN IF NOT EXISTS requires_subcategory boolean NOT NULL DEFAULT false;

UPDATE public.consumption_categories
   SET requires_subcategory = true
 WHERE lower(trim(name)) IN ('packing material', 'master packing');

-- Enforced on new items and whenever an item's category / sub-category is
-- changed. Older items without one are listed on the Setup Check page.
CREATE OR REPLACE FUNCTION public.items_require_subcategory()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_required boolean;
  v_name     text;
BEGIN
  IF NEW.category IS DISTINCT FROM 'raw_material'::purchase_category
     OR NEW.raw_material_category_id IS NULL
     OR NEW.raw_material_subcategory_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.raw_material_category_id IS NOT DISTINCT FROM OLD.raw_material_category_id
     AND NEW.raw_material_subcategory_id IS NOT DISTINCT FROM OLD.raw_material_subcategory_id
     AND NEW.category IS NOT DISTINCT FROM OLD.category THEN
    RETURN NEW;
  END IF;
  SELECT requires_subcategory, name INTO v_required, v_name
    FROM public.consumption_categories WHERE id = NEW.raw_material_category_id;
  IF coalesce(v_required, false) THEN
    RAISE EXCEPTION 'Pick a Sub-Category: it is required for %', v_name;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_items_require_subcategory ON public.items;
CREATE TRIGGER trg_items_require_subcategory
  BEFORE INSERT OR UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.items_require_subcategory();

-- ------------------------------------------------------------
-- 5. Stock now
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pk_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date $$;

-- Distributor lines carry their own unit: pieces are converted to dozens.
CREATE OR REPLACE FUNCTION public.distributor_qty_dozens(p_qty numeric, p_unit text)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(coalesce(p_unit, ''))) IN ('pieces', 'piece', 'pcs', 'pc', 'pcs.')
      THEN coalesce(p_qty, 0) / 12.0
    ELSE coalesce(p_qty, 0)
  END
$$;

-- One row per item: last count, GRNs after it, min / max, staleness.
CREATE OR REPLACE FUNCTION public.item_stock_now(p_item_ids uuid[])
RETURNS TABLE (
  item_id uuid,
  item_name text,
  unit text,
  raw_material_id uuid,
  closing_frequency text,
  last_count_date date,
  last_count_qty numeric,
  grn_since numeric,
  stock_now numeric,
  stock_known boolean,
  count_is_old boolean,
  min_stock numeric,
  max_stock numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH it AS (
    SELECT i.id, i.name, i.min_stock, i.max_stock, i.consumption_raw_material_id AS rm_id,
           coalesce(u.symbol, crm.unit, '') AS unit,
           coalesce(crm.closing_frequency, 'daily') AS freq
      FROM public.items i
      LEFT JOIN public.units_of_measure u ON u.id = i.uom_id
      LEFT JOIN public.consumption_raw_materials crm ON crm.id = i.consumption_raw_material_id
     WHERE i.id = ANY (p_item_ids)
  ),
  lc AS (
    SELECT DISTINCT ON (sc.raw_material_id) sc.raw_material_id, sc.closing_date, sc.closing_quantity
      FROM public.consumption_stock_closing sc
     WHERE sc.raw_material_id IN (SELECT rm_id FROM it WHERE rm_id IS NOT NULL)
     ORDER BY sc.raw_material_id, sc.closing_date DESC
  )
  SELECT it.id,
         it.name::text,
         it.unit::text,
         it.rm_id,
         it.freq,
         lc.closing_date,
         lc.closing_quantity,
         coalesce(g.qty, 0),
         CASE WHEN lc.closing_date IS NULL THEN NULL
              ELSE lc.closing_quantity + coalesce(g.qty, 0) END,
         lc.closing_date IS NOT NULL,
         CASE WHEN lc.closing_date IS NULL THEN false
              WHEN it.freq = 'weekly' THEN public.pk_today() - lc.closing_date > 8
              ELSE public.pk_today() - lc.closing_date > 2 END,
         coalesce(it.min_stock, 0),
         coalesce(it.max_stock, 0)
    FROM it
    LEFT JOIN lc ON lc.raw_material_id = it.rm_id
    LEFT JOIN LATERAL (
      SELECT sum(r.receipt_quantity) AS qty
        FROM public.v_consumption_grn_receipts r
       WHERE r.raw_material_id = it.rm_id
         AND r.receipt_date > lc.closing_date
    ) g ON true
$$;

-- Purchase suggestion: back up to min stock, never above max stock.
CREATE OR REPLACE FUNCTION public.material_suggest_qty(
  p_needed numeric, p_stock numeric, p_min numeric, p_max numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stock IS NULL THEN NULL
    WHEN p_needed - p_stock + coalesce(p_min, 0) <= 0 THEN 0
    WHEN coalesce(p_max, 0) > 0
      THEN greatest(0, least(p_needed - p_stock + coalesce(p_min, 0),
                             p_max - (p_stock - p_needed)))
    ELSE p_needed - p_stock + coalesce(p_min, 0)
  END
$$;

-- ------------------------------------------------------------
-- 6. The check
-- ------------------------------------------------------------

-- Order lines → product → effective materials → needed per item, plus a
-- 'not_set' row per product that has no materials at all.
-- p_source_type: 'sales_order' | 'distributor_order'
CREATE OR REPLACE FUNCTION public.material_check_compute(p_source_type text, p_source_id uuid)
RETURNS TABLE (
  item_id uuid,
  item_name text,
  unit text,
  slots text,
  used_by text,
  needed numeric,
  stock_now numeric,
  last_count_date date,
  stock_after numeric,
  min_stock numeric,
  max_stock numeric,
  result text,
  count_is_old boolean,
  suggest_qty numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH lines AS (
    SELECT soi.product_id, soi.quantity_dozens::numeric AS dozens
      FROM public.sales_order_items soi
     WHERE p_source_type = 'sales_order' AND soi.order_id = p_source_id
       AND soi.product_id IS NOT NULL
    UNION ALL
    SELECT doi.company_product_id, public.distributor_qty_dozens(doi.quantity, doi.unit)
      FROM public.distributor_order_items doi
     WHERE p_source_type = 'distributor_order' AND doi.order_id = p_source_id
       AND doi.company_product_id IS NOT NULL
  ),
  per_product AS (
    SELECT l.product_id, sum(l.dozens) AS dozens FROM lines l GROUP BY l.product_id
  ),
  need AS (
    SELECT e.item_id,
           string_agg(DISTINCT s.label, ', ') AS slots,
           string_agg(DISTINCT p.name, ', ') AS used_by,
           sum(pp.dozens * e.qty_per_dozen * (1 + e.wastage_pct / 100.0)) AS needed
      FROM per_product pp
      JOIN public.v_product_materials_effective e ON e.product_id = pp.product_id
      JOIN public.product_material_slots s ON s.key = e.slot
      JOIN public.products p ON p.id = pp.product_id
     GROUP BY e.item_id
  ),
  stock AS (
    SELECT * FROM public.item_stock_now(ARRAY(SELECT n.item_id FROM need n))
  )
  SELECT n.item_id,
         st.item_name,
         st.unit,
         n.slots,
         n.used_by,
         round(n.needed, 3),
         st.stock_now,
         st.last_count_date,
         CASE WHEN st.stock_known THEN round(st.stock_now - n.needed, 3) END,
         st.min_stock,
         st.max_stock,
         CASE
           WHEN NOT st.stock_known THEN 'unknown'
           WHEN n.needed > st.stock_now THEN 'short'
           WHEN st.min_stock > 0 AND st.stock_now - n.needed < st.min_stock THEN 'below_min'
           ELSE 'ok'
         END,
         st.count_is_old,
         round(public.material_suggest_qty(n.needed, st.stock_now, st.min_stock, st.max_stock), 3)
    FROM need n
    JOIN stock st ON st.item_id = n.item_id
  UNION ALL
  SELECT NULL::uuid, p.name::text, NULL::text, NULL::text, p.name::text,
         pp.dozens, NULL::numeric, NULL::date, NULL::numeric, NULL::numeric, NULL::numeric,
         'not_set', false, NULL::numeric
    FROM per_product pp
    JOIN public.products p ON p.id = pp.product_id
   WHERE NOT EXISTS (SELECT 1 FROM public.v_product_materials_effective e
                      WHERE e.product_id = pp.product_id);
END;
$$;

-- Draft / pre-approval preview: same numbers, nothing saved, nobody notified.
CREATE OR REPLACE FUNCTION public.material_check_preview(p_source_type text, p_source_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY
           CASE c.result WHEN 'short' THEN 1 WHEN 'unknown' THEN 2 WHEN 'not_set' THEN 3
                         WHEN 'below_min' THEN 4 ELSE 5 END, c.item_name), '[]'::jsonb)
    FROM public.material_check_compute(p_source_type, p_source_id) c
$$;

CREATE TABLE IF NOT EXISTS public.material_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('sales_order', 'distributor_order')),
  source_id uuid NOT NULL,
  order_number text,
  order_label text,          -- 'Private Label' | 'Domestic' | 'Export' | 'Distributor'
  order_link text,           -- in-app route of the order list
  reason text NOT NULL CHECK (reason IN ('confirmed', 'updated')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'superseded', 'closed')),
  short_count integer NOT NULL DEFAULT 0,
  below_min_count integer NOT NULL DEFAULT 0,
  unknown_count integer NOT NULL DEFAULT 0,
  not_set_count integer NOT NULL DEFAULT 0,
  old_count integer NOT NULL DEFAULT 0,
  ok_count integer NOT NULL DEFAULT 0,
  signature text,
  closed_reason text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_checks_source
  ON public.material_checks(source_type, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_material_checks_open
  ON public.material_checks(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS public.material_check_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.material_checks(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.items(id) ON DELETE SET NULL,
  item_name text,
  unit text,
  slots text,
  used_by text,
  needed numeric,
  stock_now numeric,
  last_count_date date,
  stock_after numeric,
  min_stock numeric,
  max_stock numeric,
  result text NOT NULL CHECK (result IN ('ok', 'short', 'below_min', 'unknown', 'not_set')),
  count_is_old boolean NOT NULL DEFAULT false,
  suggest_qty numeric,
  purchase_status text NOT NULL DEFAULT 'new'
    CHECK (purchase_status IN ('new', 'seen', 'po_raised', 'received')),
  po_reference text,
  status_updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  status_updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_material_check_lines_check ON public.material_check_lines(check_id);
CREATE INDEX IF NOT EXISTS idx_material_check_lines_item ON public.material_check_lines(item_id);

ALTER TABLE public.material_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_check_lines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_material_checks ON public.material_checks;
CREATE POLICY allow_read_material_checks ON public.material_checks FOR SELECT USING (true);
DROP POLICY IF EXISTS allow_read_material_check_lines ON public.material_check_lines;
CREATE POLICY allow_read_material_check_lines ON public.material_check_lines FOR SELECT USING (true);

-- Roles that receive stock alerts.
CREATE OR REPLACE FUNCTION public.material_alert_roles()
RETURNS app_role[]
LANGUAGE sql
IMMUTABLE
AS $$ SELECT ARRAY['store_operator', 'purchase_manager', 'purchase_officer', 'admin', 'super_admin']::app_role[] $$;

-- Rows of a computed check carried as jsonb (no temp tables needed).
CREATE OR REPLACE FUNCTION public.material_check_rows(p_rows jsonb)
RETURNS TABLE (
  item_id uuid, item_name text, unit text, slots text, used_by text, needed numeric,
  stock_now numeric, last_count_date date, stock_after numeric, min_stock numeric,
  max_stock numeric, result text, count_is_old boolean, suggest_qty numeric
)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT * FROM jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) AS r(
    item_id uuid, item_name text, unit text, slots text, used_by text, needed numeric,
    stock_now numeric, last_count_date date, stock_after numeric, min_stock numeric,
    max_stock numeric, result text, count_is_old boolean, suggest_qty numeric)
$$;

-- Run the check for one order, save the snapshot and notify when something
-- is wrong. Skips orders with no lines and re-runs whose result did not
-- change. A re-run within 2 minutes of the previous one (an edit form saving
-- its lines one by one) moves the existing alert onto the new snapshot
-- instead of sending another. Returns the open check id.
CREATE OR REPLACE FUNCTION public.material_check_run(
  p_source_type text, p_source_id uuid, p_actor uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev       public.material_checks%ROWTYPE;
  v_rows_json  jsonb;
  v_id         uuid;
  v_number     text;
  v_label      text;
  v_link       text;
  v_sig        text;
  v_rows       integer;
  v_short      integer;
  v_below      integer;
  v_unknown    integer;
  v_not_set    integer;
  v_old        integer;
  v_ok         integer;
  v_title      text;
  v_msg        text;
  v_reason     text;
  v_merge      boolean;
  v_bad        boolean;
BEGIN
  IF p_source_type = 'sales_order' THEN
    SELECT so.order_number,
           CASE so.sales_segment::text WHEN 'domestic' THEN 'Domestic'
                                       WHEN 'export' THEN 'Export' ELSE 'Private Label' END,
           CASE so.sales_segment::text WHEN 'domestic' THEN '/domestic/orders'
                                       WHEN 'export' THEN '/export/orders' ELSE '/sales/orders' END
      INTO v_number, v_label, v_link
      FROM public.sales_orders so WHERE so.id = p_source_id;
  ELSE
    SELECT d.order_number, 'Distributor', '/distributor/approvals'
      INTO v_number, v_label, v_link
      FROM public.distributor_orders d WHERE d.id = p_source_id;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_rows_json
    FROM public.material_check_compute(p_source_type, p_source_id) c;

  SELECT count(*),
         count(*) FILTER (WHERE r.result = 'short'),
         count(*) FILTER (WHERE r.result = 'below_min'),
         count(*) FILTER (WHERE r.result = 'unknown'),
         count(*) FILTER (WHERE r.result = 'not_set'),
         count(*) FILTER (WHERE r.count_is_old AND r.result <> 'unknown'),
         count(*) FILTER (WHERE r.result = 'ok'),
         md5(coalesce(string_agg(coalesce(r.item_id::text, r.item_name) || ':' || r.needed::text || ':' || r.result
                                 || ':' || r.count_is_old::text, '|' ORDER BY coalesce(r.item_id::text, r.item_name)), ''))
    INTO v_rows, v_short, v_below, v_unknown, v_not_set, v_old, v_ok, v_sig
    FROM public.material_check_rows(v_rows_json) r;

  SELECT * INTO v_prev FROM public.material_checks
   WHERE source_type = p_source_type AND source_id = p_source_id AND status = 'open'
   ORDER BY created_at DESC LIMIT 1;

  -- Nothing to check yet (e.g. header saved before its lines).
  IF v_rows = 0 THEN
    RETURN v_prev.id;
  END IF;

  -- Same result as the open check: keep it, no new alert.
  IF v_prev.id IS NOT NULL AND v_prev.signature = v_sig THEN
    RETURN v_prev.id;
  END IF;

  v_merge := v_prev.id IS NOT NULL AND v_prev.created_at > now() - interval '2 minutes';
  v_reason := CASE WHEN v_prev.id IS NULL THEN 'confirmed'
                   WHEN v_merge THEN v_prev.reason
                   ELSE 'updated' END;
  v_bad := v_short + v_below + v_unknown + v_not_set + v_old > 0;

  INSERT INTO public.material_checks
    (source_type, source_id, order_number, order_label, order_link, reason,
     short_count, below_min_count, unknown_count, not_set_count, old_count, ok_count,
     signature, created_by)
  VALUES
    (p_source_type, p_source_id, v_number, v_label, v_link, v_reason,
     v_short, v_below, v_unknown, v_not_set, v_old, v_ok, v_sig, p_actor)
  RETURNING id INTO v_id;

  -- Purchase follow-up already recorded for an item carries over.
  INSERT INTO public.material_check_lines
    (check_id, item_id, item_name, unit, slots, used_by, needed, stock_now, last_count_date,
     stock_after, min_stock, max_stock, result, count_is_old, suggest_qty,
     purchase_status, po_reference, status_updated_by, status_updated_at)
  SELECT v_id, r.item_id, r.item_name, r.unit, r.slots, r.used_by, r.needed, r.stock_now,
         r.last_count_date, r.stock_after, r.min_stock, r.max_stock, r.result, r.count_is_old,
         r.suggest_qty,
         coalesce(pl.purchase_status, 'new'), pl.po_reference, pl.status_updated_by, pl.status_updated_at
    FROM public.material_check_rows(v_rows_json) r
    LEFT JOIN public.material_check_lines pl
      ON v_prev.id IS NOT NULL AND pl.check_id = v_prev.id AND pl.item_id = r.item_id;

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.material_checks SET status = 'superseded' WHERE id = v_prev.id;
  END IF;

  -- Alert only when something needs attention (or an earlier alert changed).
  IF v_bad OR v_prev.id IS NOT NULL THEN
    v_title := CASE
      WHEN v_reason = 'updated' THEN 'Updated - ' || coalesce(v_number, v_label) || ' re-checked'
      WHEN v_short > 0 THEN 'Material short - ' || coalesce(v_number, v_label)
      WHEN v_below > 0 THEN 'Below min stock - ' || coalesce(v_number, v_label)
      ELSE 'Stock check warning - ' || coalesce(v_number, v_label)
    END;

    SELECT concat_ws(' | ',
             CASE WHEN v_short > 0 THEN v_short || ' short' END,
             CASE WHEN v_below > 0 THEN v_below || ' below min stock' END,
             CASE WHEN v_unknown > 0 THEN v_unknown || ' stock unknown' END,
             CASE WHEN v_not_set > 0 THEN v_not_set || ' product(s) with materials not set' END,
             CASE WHEN v_old > 0 THEN v_old || ' old count' END,
             CASE WHEN NOT v_bad THEN 'All materials OK now' END)
           || coalesce('. ' || (
             SELECT string_agg(s.item_name || ' short by ' || rtrim(to_char(-s.stock_after, 'FM999,999,990.###'), '.') || ' ' || coalesce(s.unit, ''), '; ')
               FROM (SELECT * FROM public.material_check_rows(v_rows_json) x
                      WHERE x.result = 'short' ORDER BY x.stock_after LIMIT 3) s), '')
           || '. ' || v_label || ' order.'
      INTO v_msg;

    IF v_merge THEN
      UPDATE public.notifications
         SET title = left(v_title, 200),
             message = v_msg,
             type = CASE WHEN v_bad THEN 'error' ELSE 'info' END,
             link = '/purchase/material-shortages?check=' || v_id,
             reference_id = v_id
       WHERE reference_type = 'material_check' AND reference_id = v_prev.id;
      IF NOT FOUND AND v_bad THEN
        PERFORM public.notify_role(public.material_alert_roles(), left(v_title, 200), v_msg, 'error', 'stock',
          '/purchase/material-shortages?check=' || v_id, 'material_check', v_id, p_actor, NULL);
      END IF;
    ELSE
      PERFORM public.notify_role(
        public.material_alert_roles(),
        left(v_title, 200),
        v_msg,
        CASE WHEN v_bad THEN 'error' ELSE 'info' END,
        'stock',
        '/purchase/material-shortages?check=' || v_id,
        'material_check',
        v_id,
        p_actor,
        NULL);
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

-- Order cancelled / rejected: close its open check and grey out its alerts.
CREATE OR REPLACE FUNCTION public.material_check_close(
  p_source_type text, p_source_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT array_agg(id) INTO v_ids FROM public.material_checks
   WHERE source_type = p_source_type AND source_id = p_source_id AND status <> 'closed';
  IF v_ids IS NULL THEN RETURN; END IF;

  UPDATE public.material_checks
     SET status = 'closed', closed_reason = p_reason
   WHERE id = ANY (v_ids);

  UPDATE public.notifications
     SET type = 'info',
         title = left('Order ' || p_reason || ' - stock alert closed: ' || title, 200)
   WHERE reference_type = 'material_check' AND reference_id = ANY (v_ids)
     AND title NOT LIKE 'Order % - stock alert closed:%';
END;
$$;

-- Purchase follow-up on a material across all open checks (status only;
-- nothing is ordered by the system).
CREATE OR REPLACE FUNCTION public.material_set_purchase_status(
  p_item_id uuid, p_status text, p_po_reference text, p_actor uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_status NOT IN ('new', 'seen', 'po_raised', 'received') THEN
    RAISE EXCEPTION 'Unknown purchase status %', p_status;
  END IF;
  UPDATE public.material_check_lines l
     SET purchase_status = p_status,
         po_reference = CASE WHEN p_status IN ('po_raised', 'received')
                             THEN coalesce(nullif(trim(p_po_reference), ''), l.po_reference) ELSE l.po_reference END,
         status_updated_by = p_actor,
         status_updated_at = now()
    FROM public.material_checks c
   WHERE c.id = l.check_id AND c.status = 'open' AND l.item_id = p_item_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Shortage Summary: open checks grouped by material, with live stock.
CREATE OR REPLACE FUNCTION public.material_shortage_summary()
RETURNS TABLE (
  item_id uuid,
  item_name text,
  unit text,
  slots text,
  orders jsonb,
  total_needed numeric,
  stock_now numeric,
  last_count_date date,
  count_is_old boolean,
  min_stock numeric,
  max_stock numeric,
  result text,
  suggest_qty numeric,
  purchase_status text,
  po_reference text,
  status_updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH open_lines AS (
    SELECT l.*, c.order_number, c.order_label, c.source_type, c.source_id
      FROM public.material_check_lines l
      JOIN public.material_checks c ON c.id = l.check_id
     WHERE c.status = 'open' AND l.item_id IS NOT NULL
  ),
  agg AS (
    SELECT ol.item_id,
           max(ol.item_name) AS item_name,
           string_agg(DISTINCT ol.slots, ', ') AS slots,
           jsonb_agg(DISTINCT jsonb_build_object('number', ol.order_number, 'label', ol.order_label,
                                                 'source_type', ol.source_type, 'source_id', ol.source_id)) AS orders,
           sum(ol.needed) AS total_needed,
           -- lowest progress across orders wins
           (array_agg(ol.purchase_status ORDER BY
              CASE ol.purchase_status WHEN 'new' THEN 1 WHEN 'seen' THEN 2 WHEN 'po_raised' THEN 3 ELSE 4 END))[1] AS purchase_status,
           max(ol.po_reference) AS po_reference,
           max(ol.status_updated_at) AS status_updated_at
      FROM open_lines ol
     GROUP BY ol.item_id
  )
  SELECT a.item_id, a.item_name, st.unit, a.slots, a.orders,
         round(a.total_needed, 3), st.stock_now, st.last_count_date, st.count_is_old,
         st.min_stock, st.max_stock,
         CASE
           WHEN NOT st.stock_known THEN 'unknown'
           WHEN a.total_needed > st.stock_now THEN 'short'
           WHEN st.min_stock > 0 AND st.stock_now - a.total_needed < st.min_stock THEN 'below_min'
           ELSE 'ok'
         END,
         round(public.material_suggest_qty(a.total_needed, st.stock_now, st.min_stock, st.max_stock), 3),
         a.purchase_status, a.po_reference, a.status_updated_at
    FROM agg a
    JOIN public.item_stock_now(ARRAY(SELECT item_id FROM agg)) st ON st.item_id = a.item_id
$$;

-- ------------------------------------------------------------
-- 6b. Triggers on orders
-- ------------------------------------------------------------

-- Sales orders: confirmed → check; cancelled → close.
CREATE OR REPLACE FUNCTION public.trg_sales_order_material_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Warning only: a problem in the check must never stop the order saving.
  BEGIN
    IF NEW.status = 'confirmed' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
      PERFORM public.material_check_run('sales_order', NEW.id, NEW.created_by);
    ELSIF NEW.status = 'cancelled' AND TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
      PERFORM public.material_check_close('sales_order', NEW.id, 'cancelled');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'material check skipped for sales order %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_order_material_check ON public.sales_orders;
CREATE TRIGGER trg_sales_order_material_check
  AFTER INSERT OR UPDATE OF status ON public.sales_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_order_material_check();

-- Lines of a confirmed / in-production order change (incl. Domestic, which
-- saves the header as confirmed before its lines): re-check once per statement.
CREATE OR REPLACE FUNCTION public.trg_sales_order_items_material_recheck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT so.id, so.created_by
      FROM public.sales_orders so
     WHERE so.status IN ('confirmed', 'in_production')
       AND so.id IN (
         SELECT order_id FROM changed_rows)
  LOOP
    BEGIN
      PERFORM public.material_check_run('sales_order', r.id, r.created_by);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'material re-check skipped for sales order %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_soi_material_recheck_ins ON public.sales_order_items;
CREATE TRIGGER trg_soi_material_recheck_ins
  AFTER INSERT ON public.sales_order_items
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sales_order_items_material_recheck();

DROP TRIGGER IF EXISTS trg_soi_material_recheck_upd ON public.sales_order_items;
CREATE TRIGGER trg_soi_material_recheck_upd
  AFTER UPDATE ON public.sales_order_items
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sales_order_items_material_recheck();

DROP TRIGGER IF EXISTS trg_soi_material_recheck_del ON public.sales_order_items;
CREATE TRIGGER trg_soi_material_recheck_del
  AFTER DELETE ON public.sales_order_items
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_sales_order_items_material_recheck();

-- Distributor orders: approved → check; rejected / cancelled → close.
CREATE OR REPLACE FUNCTION public.trg_distributor_order_material_check()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Warning only: a problem in the check must never stop the approval.
  BEGIN
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'approved') THEN
      PERFORM public.material_check_run('distributor_order', NEW.id, coalesce(NEW.approved_by, NEW.created_by));
    ELSIF NEW.status IN ('rejected', 'cancelled') AND TG_OP = 'UPDATE'
          AND OLD.status IS DISTINCT FROM NEW.status THEN
      PERFORM public.material_check_close('distributor_order', NEW.id, NEW.status);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'material check skipped for distributor order %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_distributor_order_material_check ON public.distributor_orders;
CREATE TRIGGER trg_distributor_order_material_check
  AFTER INSERT OR UPDATE OF status ON public.distributor_orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_distributor_order_material_check();

CREATE OR REPLACE FUNCTION public.trg_distributor_order_items_material_recheck()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT d.id, coalesce(d.approved_by, d.created_by) AS actor
      FROM public.distributor_orders d
     WHERE d.status = 'approved'
       AND d.id IN (SELECT order_id FROM changed_rows)
  LOOP
    BEGIN
      PERFORM public.material_check_run('distributor_order', r.id, r.actor);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'material re-check skipped for distributor order %: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_doi_material_recheck_ins ON public.distributor_order_items;
CREATE TRIGGER trg_doi_material_recheck_ins
  AFTER INSERT ON public.distributor_order_items
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_distributor_order_items_material_recheck();

DROP TRIGGER IF EXISTS trg_doi_material_recheck_upd ON public.distributor_order_items;
CREATE TRIGGER trg_doi_material_recheck_upd
  AFTER UPDATE ON public.distributor_order_items
  REFERENCING NEW TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_distributor_order_items_material_recheck();

DROP TRIGGER IF EXISTS trg_doi_material_recheck_del ON public.distributor_order_items;
CREATE TRIGGER trg_doi_material_recheck_del
  AFTER DELETE ON public.distributor_order_items
  REFERENCING OLD TABLE AS changed_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.trg_distributor_order_items_material_recheck();

-- ------------------------------------------------------------
-- 7. Daily jobs
-- ------------------------------------------------------------

-- 9:00 AM: one red summary of everything still open.
CREATE OR REPLACE FUNCTION public.material_morning_summary()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_short   integer;
  v_below   integer;
  v_unknown integer;
  v_orders  integer;
BEGIN
  SELECT count(*) FILTER (WHERE result = 'short'),
         count(*) FILTER (WHERE result = 'below_min'),
         count(*) FILTER (WHERE result = 'unknown')
    INTO v_short, v_below, v_unknown
    FROM public.material_shortage_summary();

  SELECT count(*) INTO v_orders FROM public.material_checks c
   WHERE c.status = 'open'
     AND (c.short_count + c.below_min_count + c.unknown_count + c.not_set_count) > 0;

  IF coalesce(v_short, 0) + coalesce(v_below, 0) + coalesce(v_unknown, 0) = 0 THEN
    RETURN 0;
  END IF;

  RETURN public.notify_role(
    public.material_alert_roles(),
    'Morning summary - material stock',
    concat_ws(' | ',
      CASE WHEN v_short > 0 THEN v_short || ' materials short' END,
      v_orders || ' order' || CASE WHEN v_orders = 1 THEN '' ELSE 's' END || ' affected',
      CASE WHEN v_below > 0 THEN v_below || ' below min stock' END,
      CASE WHEN v_unknown > 0 THEN v_unknown || ' stock unknown' END),
    'error', 'stock', '/purchase/material-shortages', 'material_summary', NULL, NULL, NULL);
END;
$$;

-- 6:00 PM: daily-count materials used by products that were not counted today.
CREATE OR REPLACE FUNCTION public.material_count_reminder()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_names text;
  v_count integer;
BEGIN
  SELECT count(*), string_agg(name, ', ' ORDER BY name)
    INTO v_count, v_names
    FROM (
      SELECT DISTINCT crm.name
        FROM public.product_materials pm
        JOIN public.items i ON i.id = pm.item_id
        JOIN public.consumption_raw_materials crm ON crm.id = i.consumption_raw_material_id
       WHERE crm.is_active
         AND coalesce(crm.closing_frequency, 'daily') = 'daily'
         AND NOT EXISTS (SELECT 1 FROM public.consumption_stock_closing sc
                          WHERE sc.raw_material_id = crm.id AND sc.closing_date = public.pk_today())
    ) m;

  IF coalesce(v_count, 0) = 0 THEN
    RETURN 0;
  END IF;

  RETURN public.notify_role(
    ARRAY['store_operator', 'closing_data_poster']::app_role[],
    'Stock count missing - ' || v_count || ' daily item' || CASE WHEN v_count > 1 THEN 's' ELSE '' END,
    left(v_names, 900) || ' not counted today. Stock alerts depend on fresh counts.',
    'warning', 'stock', '/consumption/stock-closing', 'material_count_reminder', NULL, NULL, NULL);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
     WHERE jobname IN ('material-morning-summary', 'material-count-reminder');
    -- 04:00 UTC = 9:00 AM Pakistan; 13:00 UTC = 6:00 PM Pakistan.
    PERFORM cron.schedule('material-morning-summary', '0 4 * * *', 'SELECT public.material_morning_summary()');
    PERFORM cron.schedule('material-count-reminder', '0 13 * * *', 'SELECT public.material_count_reminder()');
  END IF;
END $$;

-- ------------------------------------------------------------
-- Grants
-- ------------------------------------------------------------
GRANT SELECT ON public.v_product_materials_effective TO anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.item_stock_now(uuid[]),
  public.material_check_preview(text, uuid),
  public.material_check_run(text, uuid, uuid),
  public.material_set_purchase_status(uuid, text, text, uuid),
  public.material_shortage_summary(),
  public.distributor_qty_dozens(numeric, text),
  public.pk_today()
TO anon, authenticated;
