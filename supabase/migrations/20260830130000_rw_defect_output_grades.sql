-- ============================================================================
-- R&W ball inventory — tie defect grades to the grade they are sold as
-- ----------------------------------------------------------------------------
-- Two facts about the plant came to light after Phase 1 went in:
--
--   1. The cheap ball is an existing PRODUCTION grade. Covering consumes leaker
--      cores and the output is booked in production_entries as grade
--      "Leak ball"; rejects are sold as grade "Rejection". So the sellable
--      cheap ball is already recorded by the production module, and the R&W
--      ledger must never create it a second time.
--   2. Because those rows ARE production entries, Phase 1's derivation was
--      rewriting their quantity_rejected from checker counts. A cheap-ball
--      production row has no rejections of its own; deriving one is wrong.
--
-- This migration:
--   a. Records which production grade each defect grade is sold as.
--   b. Stops the derivation touching production rows for those output grades.
--   c. Surfaces ball models that have no grade link, since the derivation
--      bridges model -> grade through products.grade_id and silently does
--      nothing where that column is NULL.
-- ============================================================================

-- a. Defect grade -> the production grade it is sold as ---------------------
ALTER TABLE public.rw_defect_grades
  ADD COLUMN IF NOT EXISTS output_grade_id uuid REFERENCES public.grades(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.rw_defect_grades.output_grade_id IS
  'The production grade these balls are sold as (e.g. "Leak ball"). Production books that output itself, so the R&W ledger never creates it: R&W holds the defective ball up to the point production takes over.';

-- Leakers are sold as "Leak ball", rejects as "Rejection". Matched by name so
-- this works whatever the grade ids are in a given environment.
UPDATE public.rw_defect_grades dg
   SET output_grade_id = g.id
  FROM public.grades g
 WHERE dg.defect_type = 'leakage'
   AND dg.output_grade_id IS NULL
   AND btrim(lower(g.name)) = 'leak ball';

UPDATE public.rw_defect_grades dg
   SET output_grade_id = g.id
  FROM public.grades g
 WHERE dg.defect_type = 'rejection'
   AND dg.output_grade_id IS NULL
   AND btrim(lower(g.name)) = 'rejection';

-- b. Never derive a rejection figure onto a cheap-ball production row -------
-- A production entry for an output grade IS the cheap ball. Its quantity_ok is
-- the whole of it; the defects that produced it were already counted against
-- the grade they came from.
CREATE OR REPLACE FUNCTION public.rw_is_defect_output_grade(p_grade uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rw_defect_grades
     WHERE output_grade_id = p_grade AND is_active
  );
$$;

GRANT EXECUTE ON FUNCTION public.rw_is_defect_output_grade(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rw_apportion_production_rejected(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty numeric;
BEGIN
  IF p_date < public.rw_ball_cutover() OR p_grade IS NULL THEN
    RETURN;
  END IF;

  -- Cheap-ball output rows are left exactly as production entered them.
  IF public.rw_is_defect_output_grade(p_grade) THEN
    RETURN;
  END IF;

  v_qty := public.rw_defect_qty_for_production(
    p_date, p_shift, p_department, p_sub_department, p_grade);

  WITH target AS (
    SELECT pe.id,
           COALESCE(pe.quantity_produced, 0) AS qp,
           SUM(COALESCE(pe.quantity_produced, 0)) OVER (ORDER BY pe.created_at, pe.id) AS cum,
           SUM(COALESCE(pe.quantity_produced, 0)) OVER ()                              AS tot,
           ROW_NUMBER() OVER (ORDER BY pe.created_at, pe.id)                           AS rn
      FROM public.production_entries pe
     WHERE pe.entry_date = p_date
       AND pe.shift = p_shift
       AND pe.department_id = p_department
       AND COALESCE(pe.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
       AND pe.grade_id = p_grade
  ), alloc AS (
    SELECT id, qp,
           CASE
             WHEN tot > 0 THEN ROUND(v_qty * cum / tot) - ROUND(v_qty * (cum - qp) / tot)
             WHEN rn = 1  THEN v_qty
             ELSE 0
           END AS rej
      FROM target
  )
  UPDATE public.production_entries pe
     SET quantity_rejected = a.rej,
         quantity_ok       = GREATEST(a.qp - a.rej, 0),
         updated_at        = now()
    FROM alloc a
   WHERE pe.id = a.id
     AND (pe.quantity_rejected IS DISTINCT FROM a.rej
       OR pe.quantity_ok       IS DISTINCT FROM GREATEST(a.qp - a.rej, 0));
END;
$$;

-- c. Models that are counted but not linked to a grade ----------------------
-- products.grade_id is the bridge between a checker entry (per model) and a
-- production entry (per grade). Most products carry no grade today, and where
-- it is NULL the production figure simply never updates. That silence is the
-- problem; this view makes it a list.
CREATE OR REPLACE VIEW public.v_rw_unlinked_models
WITH (security_invoker = on) AS
SELECT p.id                              AS product_id,
       p.code                            AS product_code,
       p.name                            AS product_name,
       COUNT(e.id)                       AS entry_count,
       SUM(e.quantity)                   AS counted_qty,
       MIN(e.entry_date)                 AS first_counted,
       MAX(e.entry_date)                 AS last_counted,
       string_agg(DISTINCT d.name, ', ' ORDER BY d.name) AS departments
  FROM public.rw_checker_entries e
  JOIN public.products p               ON p.id = e.product_id
  JOIN public.production_departments d ON d.id = e.department_id
 WHERE p.grade_id IS NULL
 GROUP BY p.id, p.code, p.name;

COMMENT ON VIEW public.v_rw_unlinked_models IS
  'Ball models counted by a checker but not linked to a production grade. Their counts post to the ball ledger correctly, but cannot reach production_entries.quantity_rejected until products.grade_id is filled in.';

GRANT SELECT ON public.v_rw_unlinked_models TO anon, authenticated, service_role;
