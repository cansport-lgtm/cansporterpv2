-- ============================================================================
-- Step 3 of the Production → Material Consumption link: preview view
-- ----------------------------------------------------------------------------
-- Posted production entries, aggregated to the consumption module's grain:
-- one row per (entry_date, consumption product), resolved through the step-1
-- mapping and converted with the product's conversion factor.
--
-- The consumption Production Entry page shows this next to the manually typed
-- quantities so the team can validate mappings and factors in parallel run —
-- nothing is written from it yet. The step-4 sync trigger will upsert
-- consumption_production_entry rows from THIS view, so what the preview shows
-- is by construction exactly what the sync will write.
--
-- OK quantity (not gross produced) is what flows to consumption: rejected
-- output should not drive material consumption standards.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_consumption_production_from_production
WITH (security_invoker = on) AS
SELECT
  pe.entry_date,
  cp.id                                  AS product_id,
  cp.code                                AS product_code,
  cp.name                                AS product_name,
  cp.unit                                AS product_unit,
  cp.production_conversion_factor        AS conversion_factor,
  COUNT(*)                               AS entry_count,
  SUM(COALESCE(pe.quantity_ok, 0))       AS production_quantity_ok,
  ROUND(SUM(COALESCE(pe.quantity_ok, 0)) * cp.production_conversion_factor, 4)
                                         AS converted_quantity
FROM public.production_entries pe
JOIN public.consumption_products cp
  ON cp.id = public.consumption_product_for_production(pe.grade_id, pe.department_id)
WHERE pe.status = 'Posted'
GROUP BY pe.entry_date, cp.id, cp.code, cp.name, cp.unit, cp.production_conversion_factor;
