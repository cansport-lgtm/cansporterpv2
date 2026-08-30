-- ============================================================================
-- R&W ball inventory — reconcile the checker's count against the output booked
-- ----------------------------------------------------------------------------
-- Confirmed with the plant:
--   * A "Leak ball" / "Rejection" production entry records the FINISHED cheap
--     balls, and is booked by the department that FOUND the defect.
--   * Leaker cores accumulate at Jorr and are covered as a separate batch run.
--
-- Two things follow, and both are built here.
--
-- 1. A cheap-ball production row is output, not primary production. Leaving it
--    in the defect-rate and coverage views inflates the produced figure they
--    divide by, and adds rows whose own defect rate is meaningless. Excluded.
--
-- 2. Where a defect grade needs no covering — every covered leaker and every
--    reject — the department books the cheap balls the same day it counts them,
--    so the checker's count and that production entry should be THE SAME
--    NUMBER. Any difference is an error, and it is visible today with no new
--    document. Where covering is needed (Jorr leaker cores), the two are
--    separated by the batch run, so the check becomes the bin balance:
--    counted minus booked is what should still be sitting in the bin.
-- ============================================================================

-- 1. Keep cheap-ball output out of the primary-production views -------------
CREATE OR REPLACE VIEW public.v_rw_defect_vs_production
WITH (security_invoker = on) AS
WITH prod AS (
  SELECT pe.entry_date, pe.shift, pe.department_id, pe.grade_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS produced_qty
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
     AND NOT public.rw_is_defect_output_grade(pe.grade_id)
   GROUP BY pe.entry_date, pe.shift, pe.department_id, pe.grade_id
), def AS (
  SELECT e.entry_date, e.shift, e.department_id, p.grade_id,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'leakage'), 0)   AS leak_qty,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'rejection'), 0) AS reject_qty
    FROM public.rw_checker_entries e
    JOIN public.products p          ON p.id  = e.product_id
    JOIN public.rw_defect_grades dg ON dg.id = e.defect_grade_id
   GROUP BY e.entry_date, e.shift, e.department_id, p.grade_id
)
SELECT pr.entry_date,
       pr.shift,
       pr.department_id,
       d.name                                    AS department_name,
       pr.grade_id,
       g.code                                    AS grade_code,
       pr.produced_qty,
       COALESCE(df.leak_qty, 0)                  AS leak_qty,
       COALESCE(df.reject_qty, 0)                AS reject_qty,
       COALESCE(df.leak_qty, 0) + COALESCE(df.reject_qty, 0) AS defect_qty,
       CASE WHEN pr.produced_qty > 0
            THEN ROUND(100.0 * (COALESCE(df.leak_qty, 0) + COALESCE(df.reject_qty, 0))
                       / pr.produced_qty, 2)
            ELSE NULL END                        AS defect_pct
  FROM prod pr
  JOIN public.production_departments d ON d.id = pr.department_id
  JOIN public.grades g                 ON g.id = pr.grade_id
  LEFT JOIN def df
    ON df.entry_date    = pr.entry_date
   AND df.shift         = pr.shift
   AND df.department_id = pr.department_id
   AND df.grade_id      = pr.grade_id;

CREATE OR REPLACE VIEW public.v_rw_entry_coverage
WITH (security_invoker = on) AS
WITH checkpoints AS (
  SELECT DISTINCT department_id
    FROM public.rw_department_defect_grades WHERE is_active
),
produced AS (
  SELECT pe.entry_date, pe.shift, pe.department_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS produced_qty
    FROM public.production_entries pe
    JOIN checkpoints c ON c.department_id = pe.department_id
   WHERE pe.entry_date >= public.rw_ball_cutover()
     AND NOT public.rw_is_defect_output_grade(pe.grade_id)
   GROUP BY pe.entry_date, pe.shift, pe.department_id
),
counted AS (
  SELECT e.entry_date, e.shift, e.department_id,
         COUNT(*) AS entry_count, SUM(e.quantity) AS defect_qty
    FROM public.rw_checker_entries e
   GROUP BY e.entry_date, e.shift, e.department_id
)
SELECT p.entry_date,
       p.shift,
       p.department_id,
       d.name                              AS department_name,
       p.produced_qty,
       COALESCE(c.entry_count, 0)          AS entry_count,
       COALESCE(c.defect_qty, 0)           AS defect_qty,
       (c.entry_count IS NULL)             AS is_missing
  FROM produced p
  JOIN public.production_departments d ON d.id = p.department_id
  LEFT JOIN counted c
    ON c.entry_date = p.entry_date
   AND c.shift = p.shift
   AND c.department_id = p.department_id;

-- 2a. Counted vs booked, per day ---------------------------------------------
-- needs_covering says whether a same-day difference is expected: without a
-- covering step the two numbers describe the same balls on the same day, so
-- anything other than zero is an error worth chasing.
CREATE OR REPLACE VIEW public.v_rw_output_reconciliation
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
SELECT COALESCE(c.entry_date, b.entry_date)         AS entry_date,
       COALESCE(c.shift, b.shift)                   AS shift,
       COALESCE(c.department_id, b.department_id)   AS department_id,
       d.name                                       AS department_name,
       COALESCE(c.output_grade_id, b.output_grade_id) AS output_grade_id,
       g.name                                       AS output_grade_name,
       COALESCE(c.counted_qty, 0)                   AS counted_qty,
       COALESCE(b.booked_qty, 0)                    AS booked_qty,
       COALESCE(b.booked_qty, 0) - COALESCE(c.counted_qty, 0) AS variance_qty,
       COALESCE(o.needs_covering, false)            AS needs_covering,
       -- Only flag where the two SHOULD agree on the day.
       (NOT COALESCE(o.needs_covering, false)
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
   AND o.output_grade_id = COALESCE(c.output_grade_id, b.output_grade_id);

COMMENT ON VIEW public.v_rw_output_reconciliation IS
  'The checker''s count against the cheap-ball production the same department booked. Without a covering step the two describe the same balls on the same day and must match exactly; with one (Jorr leaker cores) the batch run separates them and the bin balance is the check instead — see v_rw_leaker_wip_reconciliation.';

-- 2b. The Jorr bin, against both the ledger and the covering output ---------
-- Three numbers matter, and separating them keeps the view truthful before the
-- Phase 2 transfer document exists:
--   cores_counted      what the checker said went into the bin
--   cover_out_posted   what the ledger says has left it (0 until Phase 2)
--   cheap_balls_booked what production says came out of the covering run
-- bin_check is pure ledger arithmetic and should always be zero. unreleased_qty
-- is cheap balls produced whose cores are still sitting in the bin on paper —
-- in Phase 1 that is every covering run, because nothing releases them yet.
-- Dropped rather than replaced: the column list changed shape.
DROP VIEW IF EXISTS public.v_rw_leaker_wip_reconciliation;
CREATE VIEW public.v_rw_leaker_wip_reconciliation
WITH (security_invoker = on) AS
WITH wip_depts AS (
  SELECT DISTINCT m.department_id, dg.output_grade_id
    FROM public.rw_department_defect_grades m
    JOIN public.rw_defect_grades dg ON dg.id = m.defect_grade_id
   WHERE m.is_active AND dg.is_active
     AND dg.onward_route = 'cover_then_store'
     AND dg.output_grade_id IS NOT NULL
),
counted AS (
  SELECT e.department_id, SUM(e.quantity) AS cores_counted
    FROM public.rw_checker_entries e
    JOIN public.rw_defect_grades dg ON dg.id = e.defect_grade_id
   WHERE dg.onward_route = 'cover_then_store'
     AND e.entry_date >= public.rw_ball_cutover()
   GROUP BY e.department_id
),
released AS (
  SELECT l.department_id, SUM(g.quantity_out) AS cover_out_posted
    FROM public.rw_ball_ledger g
    JOIN public.rw_locations l ON l.id = g.location_id
   WHERE l.location_type = 'leaker_wip'
     AND g.source_type = 'cover_out'
   GROUP BY l.department_id
),
booked AS (
  SELECT pe.department_id, pe.grade_id, SUM(COALESCE(pe.quantity_produced, 0)) AS balls_booked
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
   GROUP BY pe.department_id, pe.grade_id
),
on_hand AS (
  SELECT l.department_id, SUM(s.quantity) AS bin_quantity
    FROM public.rw_ball_stock s
    JOIN public.rw_locations l ON l.id = s.location_id
   WHERE l.location_type = 'leaker_wip'
   GROUP BY l.department_id
)
SELECT w.department_id,
       d.name                                   AS department_name,
       COALESCE(c.cores_counted, 0)             AS cores_counted,
       COALESCE(r.cover_out_posted, 0)          AS cover_out_posted,
       COALESCE(h.bin_quantity, 0)              AS bin_quantity,
       COALESCE(b.balls_booked, 0)              AS cheap_balls_booked,
       -- pure ledger arithmetic: always zero unless something posted oddly
       COALESCE(h.bin_quantity, 0)
         - (COALESCE(c.cores_counted, 0) - COALESCE(r.cover_out_posted, 0)) AS bin_check,
       -- cheap balls produced whose cores have not been released from the bin
       COALESCE(b.balls_booked, 0) - COALESCE(r.cover_out_posted, 0)        AS unreleased_qty
  FROM wip_depts w
  JOIN public.production_departments d ON d.id = w.department_id
  LEFT JOIN counted  c ON c.department_id = w.department_id
  LEFT JOIN released r ON r.department_id = w.department_id
  LEFT JOIN booked   b ON b.department_id = w.department_id AND b.grade_id = w.output_grade_id
  LEFT JOIN on_hand  h ON h.department_id = w.department_id;

COMMENT ON VIEW public.v_rw_leaker_wip_reconciliation IS
  'Leaker-WIP bin against the ledger and against covering output. bin_check is ledger arithmetic and should always be zero. unreleased_qty is cheap balls booked whose cores have not left the bin — until the Phase 2 cover transfer exists that is every covering run, so read it as work waiting for Phase 2 rather than as a loss.';

GRANT SELECT ON public.v_rw_output_reconciliation, public.v_rw_leaker_wip_reconciliation
  TO anon, authenticated, service_role;
