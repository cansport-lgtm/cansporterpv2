-- ============================================================================
-- production_monthly_report: expose department_id
-- ----------------------------------------------------------------------------
-- The Monthly Production page gains a department filter; matching rows to the
-- selected department by name is fragile (names carry trailing spaces and can
-- be edited), so the report now also returns the planning item's department id.
-- ============================================================================

DROP FUNCTION IF EXISTS public.production_monthly_report(DATE, DATE);

CREATE OR REPLACE FUNCTION public.production_monthly_report(p_from DATE, p_to DATE)
RETURNS TABLE (
  planning_item_id UUID,
  item_code TEXT,
  item_name TEXT,
  item_unit TEXT,
  department_id UUID,
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
    pd.id,
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
