-- ============================================================================
-- Sales product → Planning item link + monthly derived production report
-- ----------------------------------------------------------------------------
-- The sales/domestic modules sell from the products master while stock closing
-- (daily_stock_closing) is counted per planning_items. Nothing connects the
-- two, so monthly production cannot be derived from stock movement.
--
-- This migration:
--   1. Adds products.planning_item_id — "when this product is dispatched, the
--      stock comes out of this planning item". Many products may share one
--      planning item (packing variants); one product never draws from two.
--   2. production_monthly_report(p_from, p_to) — per planning item:
--        opening  = latest closing strictly before p_from
--        closing  = latest closing within [p_from, p_to]
--        dispatched/returned = mapped sales movement in the window
--        derived_production = closing - opening + dispatched - returned
--      derived_production is NULL when the item has no closing in the window
--      (the formula cannot be evaluated) — the page flags those rows.
--   3. production_unmapped_sales(p_from, p_to) — dispatches/returns on
--      products with no planning item mapped, so unmapped sales surface as a
--      warning instead of silently understating derived production.
-- ============================================================================

-- 1. Mapping column ----------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS planning_item_id UUID
    REFERENCES public.planning_items(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.planning_item_id IS
  'Planning item whose stock this product is dispatched from. NULL = not linked; such sales are excluded from derived production and reported by production_unmapped_sales.';

CREATE INDEX IF NOT EXISTS idx_products_planning_item
  ON public.products(planning_item_id)
  WHERE planning_item_id IS NOT NULL;

-- 2. Monthly derived production ----------------------------------------------
DROP FUNCTION IF EXISTS public.production_monthly_report(DATE, DATE);

CREATE OR REPLACE FUNCTION public.production_monthly_report(p_from DATE, p_to DATE)
RETURNS TABLE (
  planning_item_id UUID,
  item_code TEXT,
  item_name TEXT,
  item_unit TEXT,
  department_name TEXT,
  opening_qty NUMERIC,
  opening_date DATE,
  closing_qty NUMERIC,
  closing_date DATE,
  dispatched_qty NUMERIC,
  returned_qty NUMERIC,
  derived_production NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH opening AS (
    SELECT DISTINCT ON (c.planning_item_id)
           c.planning_item_id, c.closing_quantity, c.closing_date
      FROM public.daily_stock_closing c
     WHERE c.closing_date < p_from
     ORDER BY c.planning_item_id, c.closing_date DESC
  ),
  closing AS (
    SELECT DISTINCT ON (c.planning_item_id)
           c.planning_item_id, c.closing_quantity, c.closing_date
      FROM public.daily_stock_closing c
     WHERE c.closing_date BETWEEN p_from AND p_to
     ORDER BY c.planning_item_id, c.closing_date DESC
  ),
  dispatched AS (
    SELECT p.planning_item_id, SUM(sdi.quantity_dozens)::numeric AS qty
      FROM public.sales_dispatch_items sdi
      JOIN public.sales_dispatches sd ON sd.id = sdi.dispatch_id
      JOIN public.sales_order_items soi ON soi.id = sdi.order_item_id
      JOIN public.products p ON p.id = soi.product_id
     WHERE sd.dispatch_date BETWEEN p_from AND p_to
       AND p.planning_item_id IS NOT NULL
     GROUP BY p.planning_item_id
  ),
  returned AS (
    -- product resolved directly, or through the dispatch item being returned
    SELECT p.planning_item_id, SUM(sri.quantity_dozens)::numeric AS qty
      FROM public.sales_return_items sri
      JOIN public.sales_returns sr ON sr.id = sri.return_id
      LEFT JOIN public.sales_dispatch_items sdi ON sdi.id = sri.dispatch_item_id
      LEFT JOIN public.sales_order_items soi ON soi.id = sdi.order_item_id
      JOIN public.products p ON p.id = COALESCE(sri.product_id, soi.product_id)
     WHERE sr.return_date BETWEEN p_from AND p_to
       AND sr.status = 'posted'
       AND p.planning_item_id IS NOT NULL
     GROUP BY p.planning_item_id
  )
  SELECT
    pi.id,
    pi.code::text,
    pi.name::text,
    pi.unit::text,
    pd.name::text,
    COALESCE(o.closing_quantity, 0),
    o.closing_date,
    c.closing_quantity,
    c.closing_date,
    COALESCE(d.qty, 0),
    COALESCE(r.qty, 0),
    CASE WHEN c.closing_quantity IS NULL THEN NULL
         ELSE c.closing_quantity - COALESCE(o.closing_quantity, 0)
              + COALESCE(d.qty, 0) - COALESCE(r.qty, 0)
    END
  FROM public.planning_items pi
  LEFT JOIN public.production_departments pd ON pd.id = pi.department_id
  LEFT JOIN opening o    ON o.planning_item_id = pi.id
  LEFT JOIN closing c    ON c.planning_item_id = pi.id
  LEFT JOIN dispatched d ON d.planning_item_id = pi.id
  LEFT JOIN returned r   ON r.planning_item_id = pi.id
  WHERE o.planning_item_id IS NOT NULL
     OR c.planning_item_id IS NOT NULL
     OR d.planning_item_id IS NOT NULL
     OR r.planning_item_id IS NOT NULL
  ORDER BY pd.name NULLS LAST, pi.code;
$$;

-- 3. Unmapped sales visibility ------------------------------------------------
DROP FUNCTION IF EXISTS public.production_unmapped_sales(DATE, DATE);

CREATE OR REPLACE FUNCTION public.production_unmapped_sales(p_from DATE, p_to DATE)
RETURNS TABLE (
  product_id UUID,
  product_code TEXT,
  product_name TEXT,
  dispatched_qty NUMERIC,
  returned_qty NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH dispatched AS (
    SELECT soi.product_id, SUM(sdi.quantity_dozens)::numeric AS qty
      FROM public.sales_dispatch_items sdi
      JOIN public.sales_dispatches sd ON sd.id = sdi.dispatch_id
      JOIN public.sales_order_items soi ON soi.id = sdi.order_item_id
     WHERE sd.dispatch_date BETWEEN p_from AND p_to
       AND soi.product_id IS NOT NULL
     GROUP BY soi.product_id
  ),
  returned AS (
    SELECT COALESCE(sri.product_id, soi.product_id) AS product_id,
           SUM(sri.quantity_dozens)::numeric AS qty
      FROM public.sales_return_items sri
      JOIN public.sales_returns sr ON sr.id = sri.return_id
      LEFT JOIN public.sales_dispatch_items sdi ON sdi.id = sri.dispatch_item_id
      LEFT JOIN public.sales_order_items soi ON soi.id = sdi.order_item_id
     WHERE sr.return_date BETWEEN p_from AND p_to
       AND sr.status = 'posted'
       AND COALESCE(sri.product_id, soi.product_id) IS NOT NULL
     GROUP BY COALESCE(sri.product_id, soi.product_id)
  )
  SELECT
    p.id,
    p.code::text,
    p.name::text,
    COALESCE(d.qty, 0),
    COALESCE(r.qty, 0)
  FROM public.products p
  LEFT JOIN dispatched d ON d.product_id = p.id
  LEFT JOIN returned r   ON r.product_id = p.id
  WHERE p.planning_item_id IS NULL
    AND (d.product_id IS NOT NULL OR r.product_id IS NOT NULL)
  ORDER BY p.code;
$$;
