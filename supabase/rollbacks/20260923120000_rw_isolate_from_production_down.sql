-- ============================================================================
-- DOWN-migration for 20260923120000_rw_isolate_from_production
-- ----------------------------------------------------------------------------
-- Not in supabase/migrations on purpose: it must never run automatically.
-- Restores the R&W -> production link exactly as 20260830120000..20260905130000
-- left it: the derivation functions, both triggers and the five views, then
-- re-derives quantity_rejected / quantity_ok from the checker entries the same
-- way 20260905130000 did (non-posted rows only).
--
-- Re-deriving overwrites any Rejected / OK typed on the Daily Entry form
-- since the isolation, for dates from the cutover on. The frontend change
-- that re-enabled typing must be reverted alongside this script.
--
-- production_entries_rw_reset_backup is kept for audit but renamed with a
-- timestamp, so re-applying the isolation later starts a fresh backup.
-- rw_locations.inventory_location_id is not re-added (it was unused).
-- ============================================================================
BEGIN;

-- Functions ------------------------------------------------------------------
CREATE FUNCTION public.rw_defect_qty_for_production(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(e.quantity), 0)
    FROM public.rw_checker_entries e
   WHERE e.entry_date = p_date
     AND e.shift = p_shift
     AND e.department_id = p_department
     AND COALESCE(e.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
     AND e.grade_id = p_grade;
$$;
GRANT EXECUTE ON FUNCTION public.rw_defect_qty_for_production(date, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rw_apportion_production_rejected(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty numeric;
  v_locked boolean;
BEGIN
  IF p_date < public.rw_ball_cutover() OR p_grade IS NULL THEN
    RETURN;
  END IF;

  -- Cheap-ball output rows are left exactly as production entered them.
  IF public.rw_is_defect_output_grade(p_grade) THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.production_entries pe
     WHERE pe.entry_date = p_date
       AND pe.shift = p_shift
       AND pe.department_id = p_department
       AND COALESCE(pe.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
       AND pe.grade_id = p_grade
       AND pe.status = 'Posted'
  ) INTO v_locked;

  -- Posted means posted. v_rw_posted_entry_conflicts reports the gap instead.
  IF v_locked THEN
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

GRANT EXECUTE ON FUNCTION public.rw_apportion_production_rejected(date, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rw_post_checker_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_loc   uuid;
  v_route text;
  v_cost  numeric;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM public.rw_ball_ledger
     WHERE source_type = 'checker_entry' AND source_id = OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.rw_apportion_production_rejected(
      OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.grade_id);
    RETURN OLD;
  END IF;

  IF NEW.entry_date >= public.rw_ball_cutover() AND NEW.quantity > 0 THEN
    SELECT dg.onward_route INTO v_route
      FROM public.rw_defect_grades dg WHERE dg.id = NEW.defect_grade_id;

    v_loc := NEW.location_id;
    IF v_loc IS NULL THEN
      SELECT m.location_id INTO v_loc
        FROM public.rw_department_defect_grades m
       WHERE m.department_id = NEW.department_id
         AND m.defect_grade_id = NEW.defect_grade_id
         AND m.is_active;
    END IF;

    IF v_route <> 'destroy' AND v_loc IS NOT NULL THEN
      v_cost := public.rw_defect_standard_cost(NEW.grade_id, NEW.defect_grade_id);
      INSERT INTO public.rw_ball_ledger
        (txn_date, location_id, department_id, grade_id, defect_grade_id, unit,
         quantity_in, unit_cost, value_in, source_type, source_id, entered_by, remarks)
      VALUES
        (NEW.entry_date, v_loc, NEW.department_id, NEW.grade_id, NEW.defect_grade_id,
         NEW.unit, NEW.quantity, v_cost, NEW.quantity * v_cost,
         'checker_entry', NEW.id, NEW.entered_by, NEW.remarks);
    END IF;
  END IF;

  PERFORM public.rw_apportion_production_rejected(
    NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.grade_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rw_production_entry_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('rw.apportioning', true), '') = 'on' THEN
    RETURN NULL;                     -- our own UPDATE coming back round
  END IF;
  PERFORM set_config('rw.apportioning', 'on', true);

  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.rw_apportion_production_rejected(
      NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.grade_id);
  END IF;
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND
         (OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.grade_id)
         IS DISTINCT FROM
         (NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.grade_id)) THEN
    PERFORM public.rw_apportion_production_rejected(
      OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.grade_id);
  END IF;

  PERFORM set_config('rw.apportioning', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_entries_derive_rejected ON public.production_entries;
DROP TRIGGER IF EXISTS trg_production_entries_apportion ON public.production_entries;
CREATE TRIGGER trg_production_entries_apportion
  AFTER INSERT OR UPDATE OR DELETE ON public.production_entries
  FOR EACH ROW EXECUTE FUNCTION public.rw_production_entry_after_change();

-- Views ----------------------------------------------------------------------
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

COMMENT ON VIEW public.v_rw_entry_coverage IS
  'Department-days with production but no checker entry. Silence is the cheapest way to hide balls; this is what makes it visible.';

CREATE VIEW public.v_rw_defect_vs_production
WITH (security_invoker = on) AS
WITH prod AS (
  SELECT pe.entry_date, pe.shift, pe.department_id, pe.grade_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS produced_qty
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
     AND NOT public.rw_is_defect_output_grade(pe.grade_id)
   GROUP BY pe.entry_date, pe.shift, pe.department_id, pe.grade_id
), def AS (
  SELECT e.entry_date, e.shift, e.department_id, e.grade_id,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'leakage'), 0)   AS leak_qty,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'rejection'), 0) AS reject_qty
    FROM public.rw_checker_entries e
    JOIN public.rw_defect_grades dg ON dg.id = e.defect_grade_id
   GROUP BY e.entry_date, e.shift, e.department_id, e.grade_id
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

GRANT SELECT ON public.v_rw_defect_vs_production TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_rw_defect_vs_production IS
  'Live defect rate per production key. An implausible count is visible on the day it is typed, not when the store is next counted.';

GRANT SELECT ON public.v_rw_entry_coverage TO anon, authenticated, service_role;

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

GRANT SELECT ON public.v_rw_leaker_wip_reconciliation TO anon, authenticated, service_role;

CREATE VIEW public.v_rw_posted_entry_conflicts
WITH (security_invoker = on) AS
SELECT pe.entry_date,
       pe.shift,
       pe.department_id,
       d.name                                    AS department_name,
       pe.grade_id,
       g.code                                    AS grade_code,
       SUM(COALESCE(pe.quantity_rejected, 0))    AS posted_rejected,
       public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       )                                         AS counted_rejected,
       public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       ) - SUM(COALESCE(pe.quantity_rejected, 0)) AS variance_qty,
       COUNT(*)                                  AS posted_rows
  FROM public.production_entries pe
  JOIN public.production_departments d ON d.id = pe.department_id
  JOIN public.grades g                 ON g.id = pe.grade_id
 WHERE pe.status = 'Posted'
   AND pe.entry_date >= public.rw_ball_cutover()
   AND NOT public.rw_is_defect_output_grade(pe.grade_id)
 GROUP BY pe.entry_date, pe.shift, pe.department_id, d.name,
          pe.grade_id, g.code, pe.sub_department_id
HAVING public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       ) IS DISTINCT FROM SUM(COALESCE(pe.quantity_rejected, 0));

GRANT SELECT ON public.v_rw_posted_entry_conflicts TO anon, authenticated, service_role;

COMMENT ON VIEW public.v_rw_posted_entry_conflicts IS
  'Posted production entries whose rejected figure no longer agrees with the floor count. The posting lock deliberately keeps them frozen, so these need an unpost by someone with the production approve permission before they will update.';

-- Re-derive -------------------------------------------------------------------
-- The touch re-fires trg_rw_checker_entries_post under the restored function,
-- rebuilding the ledger rows and the derived production figures.
UPDATE public.rw_checker_entries SET entered_at = entered_at;

DO $$
BEGIN
  IF to_regclass('public.production_entries_rw_reset_backup') IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.production_entries_rw_reset_backup RENAME TO %I',
                   'production_entries_rw_reset_backup_' || to_char(now(), 'YYYYMMDDHH24MISS'));
  END IF;
END $$;

COMMIT;
