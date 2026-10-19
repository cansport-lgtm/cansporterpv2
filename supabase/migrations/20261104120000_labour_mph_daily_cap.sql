-- ============================================================================
-- Labour MPH: at most 12 MPH per worker per day, enforced by the database
-- ----------------------------------------------------------------------------
-- MPH comes from work_type (full day 12, half day 6), and a worker can have
-- several productivity rows on one date. The 12 MPH limit was only checked by
-- the entry form, so every other path could go over it:
--   * approving an edit request (16 Oct 2026: a 6 MPH row moved to a 12 MPH
--     full day while the worker's other 6 MPH row stayed — 18 MPH);
--   * the Overtime dialog, whose month query ended on "<month>-31", which
--     Postgres refuses for 30-day months and February; it then found no entry
--     and made an "overtime only" full day next to the real one (24 MPH);
--   * Excel import, and two people saving at the same moment.
--
-- 1. Clean-up of the days already over 12 MPH:
--    a. "Overtime only" rows (no process, no quantities, overtime > 0) on a
--       day that also has a real entry: the overtime amount and remark move
--       onto the worker's first real entry of that day, and the extra row is
--       deleted. Salary is unchanged — pay counts at most one day per date and
--       adds up overtime across rows.
--    b. A draft row left behind on a day the worker also has an approved full
--       day (he was moved to another department for the whole day) is deleted.
--    The migration stops if any day is still over 12 MPH after that.
-- 2. labour_productivity_mph_cap: after any insert or update that adds MPH,
--    the worker's total for that date must be 12 or less, or the change is
--    refused with a message naming the other entries. A per worker/day
--    advisory lock makes two simultaneous saves queue instead of both passing.
--
-- Rollback: supabase/rollbacks/20261104120000_labour_mph_daily_cap_down.sql
-- (removes the rule; the clean-up is not undone).
-- ============================================================================

-- 1a. Fold "overtime only" rows into the real entry of the same day ----------
WITH over_days AS (
  SELECT employee_id, target_date
    FROM public.labour_productivity_targets
   GROUP BY employee_id, target_date
  HAVING sum(mph) > 12
), ot_rows AS (
  SELECT t.*
    FROM public.labour_productivity_targets t
    JOIN over_days o USING (employee_id, target_date)
   WHERE t.process_id IS NULL
     AND COALESCE(t.target_quantity, 0) = 0
     AND COALESCE(t.actual_quantity, 0) = 0
     AND COALESCE(t.overtime_amount, 0) > 0
), moves AS (
  SELECT ot.id AS ot_id, ot.overtime_amount, ot.remarks AS ot_remarks,
         (SELECT r.id FROM public.labour_productivity_targets r
           WHERE r.employee_id = ot.employee_id AND r.target_date = ot.target_date
             AND r.id NOT IN (SELECT id FROM ot_rows)
           ORDER BY r.created_at LIMIT 1) AS keep_id
    FROM ot_rows ot
), moved AS (
  UPDATE public.labour_productivity_targets k
     SET overtime_amount = COALESCE(k.overtime_amount, 0) + m.overtime_amount,
         remarks = concat_ws(' · ', NULLIF(btrim(k.remarks), ''),
                             CASE WHEN m.ot_remarks ILIKE 'OT:%' THEN m.ot_remarks ELSE 'OT' END)
    FROM moves m
   WHERE k.id = m.keep_id
  RETURNING m.ot_id
)
DELETE FROM public.labour_productivity_targets t
 USING moved
 WHERE t.id = moved.ot_id;

-- 1b. Drop draft leftovers next to an approved full day ---------------------
WITH over_days AS (
  SELECT employee_id, target_date
    FROM public.labour_productivity_targets
   GROUP BY employee_id, target_date
  HAVING sum(mph) > 12
)
DELETE FROM public.labour_productivity_targets t
 USING over_days o
 WHERE t.employee_id = o.employee_id AND t.target_date = o.target_date
   AND t.status = 'draft'
   AND EXISTS (SELECT 1 FROM public.labour_productivity_targets f
                WHERE f.employee_id = t.employee_id AND f.target_date = t.target_date
                  AND f.id <> t.id AND f.status = 'approved' AND f.work_type = 'full_day');

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM (
    SELECT 1 FROM public.labour_productivity_targets
     GROUP BY employee_id, target_date HAVING sum(mph) > 12) x;
  IF v_n > 0 THEN
    RAISE EXCEPTION '% worker-day(s) are still over 12 MPH; fix them before adding the limit', v_n;
  END IF;
END;
$$;

-- 2. The limit ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.labour_productivity_mph_cap()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_total numeric;
  v_others text;
  v_worker text;
BEGIN
  -- Only a change that can add MPH to a day needs the check (check-in/out,
  -- quantities, approval and the like leave the total as it was).
  IF TG_OP = 'UPDATE'
     AND NEW.employee_id IS NOT DISTINCT FROM OLD.employee_id
     AND NEW.target_date IS NOT DISTINCT FROM OLD.target_date
     AND NEW.work_type IS NOT DISTINCT FROM OLD.work_type THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('labour_mph:' || NEW.employee_id::text || ':' || NEW.target_date::text, 0));

  SELECT COALESCE(sum(mph), 0) INTO v_total
    FROM public.labour_productivity_targets
   WHERE employee_id = NEW.employee_id AND target_date = NEW.target_date;

  IF v_total > 12 THEN
    SELECT string_agg(COALESCE(d.name, 'no department') || ' ' || t.mph::int || ' MPH', ', ' ORDER BY t.created_at)
      INTO v_others
      FROM public.labour_productivity_targets t
      LEFT JOIN public.production_departments d ON d.id = t.department_id
     WHERE t.employee_id = NEW.employee_id AND t.target_date = NEW.target_date AND t.id <> NEW.id;
    SELECT btrim(COALESCE(e.employee_code, '') || ' ' || COALESCE(e.full_name, ''))
      INTO v_worker
      FROM public.labour_employees e WHERE e.id = NEW.employee_id;

    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format('Worker %s already has %s on %s. This would make %s MPH - maximum is 12 MPH per day. Remove or change the other entry first.',
                       COALESCE(v_worker, ''), COALESCE(v_others, 'other entries'),
                       to_char(NEW.target_date, 'DD Mon YYYY'), v_total::int);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS labour_productivity_mph_cap ON public.labour_productivity_targets;
CREATE TRIGGER labour_productivity_mph_cap
  AFTER INSERT OR UPDATE ON public.labour_productivity_targets
  FOR EACH ROW EXECUTE FUNCTION public.labour_productivity_mph_cap();
