-- ============================================================================
-- R&W ball inventory — keep the counted-vs-booked check quiet until it applies
-- ----------------------------------------------------------------------------
-- The plant intends to start booking cheap balls as production of grade
-- "Leak ball" / "Rejection", but does not yet: those grades carry zero
-- production entries today. Until that practice starts, every covered-leaker
-- and reject day would read as a mismatch — counted N against booked 0 — and a
-- check that flags everything from day one gets ignored by week two.
--
-- So the flag now needs a department to have booked that output grade at least
-- once. The comparison itself is always shown; only the flag waits. It lights
-- up on its own the first time somebody books one.
-- ============================================================================

DROP VIEW IF EXISTS public.v_rw_output_reconciliation;
CREATE VIEW public.v_rw_output_reconciliation
WITH (security_invoker = on) AS
WITH dept_output AS (
  SELECT m.department_id,
         dg.output_grade_id,
         bool_or(dg.onward_route = 'cover_then_store') AS needs_covering
    FROM public.rw_department_defect_grades m
    JOIN public.rw_defect_grades dg ON dg.id = m.defect_grade_id
   WHERE m.is_active AND dg.is_active AND dg.output_grade_id IS NOT NULL
   GROUP BY m.department_id, dg.output_grade_id
),
-- Has this department ever booked this output grade? Until it has, there is
-- nothing to compare against and a zero is absence, not a discrepancy.
booking_started AS (
  SELECT DISTINCT pe.department_id, pe.grade_id AS output_grade_id
    FROM public.production_entries pe
   WHERE public.rw_is_defect_output_grade(pe.grade_id)
),
counted AS (
  SELECT e.entry_date, e.shift, e.department_id, dg.output_grade_id,
         SUM(e.quantity) AS counted_qty
    FROM public.rw_checker_entries e
    JOIN public.rw_defect_grades dg ON dg.id = e.defect_grade_id
   WHERE dg.output_grade_id IS NOT NULL
     AND e.entry_date >= public.rw_ball_cutover()
   GROUP BY e.entry_date, e.shift, e.department_id, dg.output_grade_id
),
booked AS (
  SELECT pe.entry_date, pe.shift, pe.department_id,
         pe.grade_id AS output_grade_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS booked_qty
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
     AND public.rw_is_defect_output_grade(pe.grade_id)
   GROUP BY pe.entry_date, pe.shift, pe.department_id, pe.grade_id
)
SELECT COALESCE(c.entry_date, b.entry_date)           AS entry_date,
       COALESCE(c.shift, b.shift)                     AS shift,
       COALESCE(c.department_id, b.department_id)     AS department_id,
       d.name                                         AS department_name,
       COALESCE(c.output_grade_id, b.output_grade_id) AS output_grade_id,
       g.name                                         AS output_grade_name,
       COALESCE(c.counted_qty, 0)                     AS counted_qty,
       COALESCE(b.booked_qty, 0)                      AS booked_qty,
       COALESCE(b.booked_qty, 0) - COALESCE(c.counted_qty, 0) AS variance_qty,
       COALESCE(o.needs_covering, false)              AS needs_covering,
       (s.department_id IS NOT NULL)                  AS booking_started,
       -- Flagged only where the two should agree on the day AND the department
       -- has actually started booking this grade.
       (NOT COALESCE(o.needs_covering, false)
        AND s.department_id IS NOT NULL
        AND COALESCE(b.booked_qty, 0) <> COALESCE(c.counted_qty, 0)) AS is_mismatch
  FROM counted c
  FULL OUTER JOIN booked b
    ON b.entry_date = c.entry_date
   AND b.shift = c.shift
   AND b.department_id = c.department_id
   AND b.output_grade_id = c.output_grade_id
  JOIN public.production_departments d
    ON d.id = COALESCE(c.department_id, b.department_id)
  JOIN public.grades g
    ON g.id = COALESCE(c.output_grade_id, b.output_grade_id)
  LEFT JOIN dept_output o
    ON o.department_id = COALESCE(c.department_id, b.department_id)
   AND o.output_grade_id = COALESCE(c.output_grade_id, b.output_grade_id)
  LEFT JOIN booking_started s
    ON s.department_id = COALESCE(c.department_id, b.department_id)
   AND s.output_grade_id = COALESCE(c.output_grade_id, b.output_grade_id);

COMMENT ON VIEW public.v_rw_output_reconciliation IS
  'The checker''s count against the cheap-ball production the same department booked. is_mismatch waits for two things: no covering step between the two, and the department having booked that grade at least once — so it stays quiet until the booking practice starts, then lights up on its own.';

GRANT SELECT ON public.v_rw_output_reconciliation TO anon, authenticated, service_role;
