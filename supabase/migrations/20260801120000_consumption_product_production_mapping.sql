-- ============================================================================
-- Step 1 of the Production → Material Consumption link: product mapping
-- ----------------------------------------------------------------------------
-- The production module records output per (date, shift, department, grade) in
-- production_entries; the consumption module records it per (date, product) in
-- consumption_production_entry, keyed to its own consumption_products master.
-- Nothing connects the two today, so consumption production is retyped by hand.
--
-- This migration adds the mapping that later steps (post action, preview,
-- auto-sync) will resolve through:
--
--   1. consumption_products.grade_id / production_department_id — "production
--      entries with this grade (and optionally this department) are mine".
--      Department is only needed when the same grade is produced in more than
--      one department and should count as different products.
--   2. consumption_products.production_conversion_factor — production counts
--      in Bags / Press Sheets, consumption in dozens etc.;
--      consumption qty = production qty × factor.
--   3. consumption_product_for_production(grade, department) — the single
--      resolution rule (exact grade+department match wins over a grade-only
--      mapping), shared by the view now and by the sync trigger later.
--   4. v_consumption_unmapped_production — production output that resolves to
--      no product, grouped by grade/department, so gaps in the mapping are
--      visible instead of silently dropped.
--
-- No behavior changes yet: nothing writes to consumption_production_entry.
-- ============================================================================

-- 1. Mapping columns ---------------------------------------------------------
ALTER TABLE public.consumption_products
  ADD COLUMN IF NOT EXISTS grade_id UUID
    REFERENCES public.grades(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_department_id UUID
    REFERENCES public.production_departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_conversion_factor NUMERIC(12,6) NOT NULL DEFAULT 1
    CHECK (production_conversion_factor > 0);

COMMENT ON COLUMN public.consumption_products.grade_id IS
  'Production grade this product is produced as. NULL = not linked to the production module (production entries never map here).';
COMMENT ON COLUMN public.consumption_products.production_department_id IS
  'Optional narrowing when the same grade is produced in several departments. NULL = any department.';
COMMENT ON COLUMN public.consumption_products.production_conversion_factor IS
  'Multiplier from production units (Bags / Press Sheets) to this product''s consumption unit: consumption qty = production qty × factor.';

-- Two products may not claim the same grade+department combination, or the
-- sync would double-book the same production. NULL department participates in
-- uniqueness (via a fixed sentinel) so only one grade-wide mapping can exist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_consumption_product_production_map
  ON public.consumption_products (
    grade_id,
    COALESCE(production_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE grade_id IS NOT NULL AND is_active = true;

-- 2. Resolution rule ---------------------------------------------------------
-- Exact (grade, department) mapping wins; otherwise a grade-only mapping
-- (production_department_id IS NULL) catches all departments. NULL when
-- nothing matches — the entry then surfaces in v_consumption_unmapped_production.
CREATE OR REPLACE FUNCTION public.consumption_product_for_production(
  p_grade uuid,
  p_department uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
    FROM public.consumption_products
   WHERE is_active = true
     AND grade_id = p_grade
     AND (production_department_id = p_department OR production_department_id IS NULL)
   ORDER BY production_department_id NULLS LAST
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.consumption_product_for_production(uuid, uuid) TO anon, authenticated, service_role;

-- 3. Production that no mapping covers ---------------------------------------
CREATE OR REPLACE VIEW public.v_consumption_unmapped_production
WITH (security_invoker = on) AS
SELECT
  pe.grade_id,
  g.code                        AS grade_code,
  g.name                        AS grade_name,
  pe.department_id,
  d.code                        AS department_code,
  d.name                        AS department_name,
  COUNT(*)                      AS entry_count,
  SUM(COALESCE(pe.quantity_produced, 0)) AS total_produced,
  SUM(COALESCE(pe.quantity_ok, 0))       AS total_ok,
  MIN(pe.entry_date)            AS first_entry_date,
  MAX(pe.entry_date)            AS last_entry_date
FROM public.production_entries pe
JOIN public.grades g                 ON g.id = pe.grade_id
JOIN public.production_departments d ON d.id = pe.department_id
WHERE public.consumption_product_for_production(pe.grade_id, pe.department_id) IS NULL
GROUP BY pe.grade_id, g.code, g.name, pe.department_id, d.code, d.name;
