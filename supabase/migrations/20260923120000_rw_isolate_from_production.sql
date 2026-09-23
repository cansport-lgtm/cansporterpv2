-- ============================================================================
-- Isolate Rejections & Wastages from the Production module
-- ----------------------------------------------------------------------------
-- Since 20260830120000 the floor checker's count was the source of truth for
-- production_entries.quantity_rejected / quantity_ok: a trigger on each side
-- kept the two modules in lock-step, and five views joined R&W to production
-- entries for reconciliation. R&W is now a standalone module:
--
--   * R&W no longer writes to production_entries, and production_entries no
--     longer calls back into R&W. A checker entry posts to the R&W ball ledger
--     and nothing else.
--   * The views that joined R&W to production_entries are dropped.
--   * R&W keeps READING the shared masters (grades, production_departments,
--     hp_materials, employees, app_users) — it never writes them.
--   * Rejected / OK are typed on the production Daily Entry form again, for
--     every date. The figures R&W derived from 2026-09-01 are reset so they
--     can be re-entered there.
--
-- Nothing R&W owns is deleted: checker entries, the ball ledger and bin stock
-- are untouched. The manual down-migration is
-- supabase/rollbacks/20260923120000_rw_isolate_from_production_down.sql.
-- ============================================================================

-- 1. Stop production_entries calling into R&W -------------------------------
-- Dropped first, so the reset in step 5 is not re-derived by it.
DROP TRIGGER IF EXISTS trg_production_entries_apportion ON public.production_entries;
DROP FUNCTION IF EXISTS public.rw_production_entry_after_change();

-- 2. A checker entry posts to the ball ledger only --------------------------
-- Same as the 20260905130000 definition, minus the two calls to
-- rw_apportion_production_rejected.
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

  RETURN NEW;
END;
$$;

-- 3. Views that joined R&W to production_entries ----------------------------
DROP VIEW IF EXISTS public.v_rw_posted_entry_conflicts;
DROP VIEW IF EXISTS public.v_rw_output_reconciliation;
DROP VIEW IF EXISTS public.v_rw_leaker_wip_reconciliation;
DROP VIEW IF EXISTS public.v_rw_defect_vs_production;
DROP VIEW IF EXISTS public.v_rw_entry_coverage;

-- 4. The functions that fed production figures ------------------------------
DROP FUNCTION IF EXISTS public.rw_apportion_production_rejected(date, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rw_defect_qty_for_production(date, text, uuid, uuid, uuid);

-- 5. Reset the derived production figures for re-entry ----------------------
-- In scope: every row the derivation owned — from the cutover on, with a
-- grade, not a cheap-ball output grade (production always typed those), and
-- not Posted. Posted rows are frozen by the posting lock and were never
-- rewritten by R&W after posting, so they are left exactly as posted.
--
-- Reset means "no rejection recorded yet": rejected = 0, ok = produced, which
-- is what the Daily Entry form holds before anyone types a rejection. The
-- previous values are kept below so the reset can be audited or undone.
CREATE TABLE IF NOT EXISTS public.production_entries_rw_reset_backup (
  production_entry_id uuid PRIMARY KEY,
  entry_date          date    NOT NULL,
  quantity_produced   numeric NOT NULL,
  quantity_ok         numeric NOT NULL,
  quantity_rejected   numeric NOT NULL,
  backed_up_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.production_entries_rw_reset_backup IS
  'Rejected / OK figures R&W had derived onto draft production entries, saved when R&W was isolated from production (20260923120000) and the figures were reset for manual re-entry. Reference only; nothing reads it.';

-- No policies: readable only by the service role / SQL editor.
ALTER TABLE public.production_entries_rw_reset_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO public.production_entries_rw_reset_backup
  (production_entry_id, entry_date, quantity_produced, quantity_ok, quantity_rejected)
SELECT pe.id, pe.entry_date, pe.quantity_produced, pe.quantity_ok, pe.quantity_rejected
  FROM public.production_entries pe
 WHERE pe.entry_date >= public.rw_ball_cutover()
   AND pe.grade_id IS NOT NULL
   AND NOT public.rw_is_defect_output_grade(pe.grade_id)
   AND pe.status IS DISTINCT FROM 'Posted'
   AND (pe.quantity_rejected <> 0 OR pe.quantity_ok <> pe.quantity_produced)
ON CONFLICT (production_entry_id) DO NOTHING;

-- Only rows still holding the backed-up figure are reset, so a replay can
-- never wipe a Rejected / OK somebody has since re-entered by hand.
UPDATE public.production_entries pe
   SET quantity_rejected = 0,
       quantity_ok       = pe.quantity_produced,
       updated_at        = now()
  FROM public.production_entries_rw_reset_backup b
 WHERE b.production_entry_id = pe.id
   AND pe.status IS DISTINCT FROM 'Posted'
   AND pe.quantity_rejected = b.quantity_rejected
   AND pe.quantity_ok       = b.quantity_ok;

DO $$
DECLARE
  v_reset  integer;
  v_posted integer;
BEGIN
  SELECT COUNT(*) INTO v_reset
    FROM public.production_entries pe
    JOIN public.production_entries_rw_reset_backup b ON b.production_entry_id = pe.id
   WHERE pe.quantity_rejected = 0 AND pe.quantity_ok = pe.quantity_produced;
  SELECT COUNT(*) INTO v_posted
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
     AND pe.grade_id IS NOT NULL
     AND NOT public.rw_is_defect_output_grade(pe.grade_id)
     AND pe.status = 'Posted';
  RAISE NOTICE 'R&W isolation: % draft production entries reset for re-entry; % posted entries left as posted.',
    v_reset, v_posted;
END $$;

-- 6. Reserved inventory link --------------------------------------------------
-- rw_locations.inventory_location_id was reserved for a later phase that tied
-- bins to the inventory module. Nothing writes it; drop it only if that is
-- still true, so no data is ever lost here.
DO $$
DECLARE
  v_used boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'rw_locations'
                    AND column_name = 'inventory_location_id') THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.rw_locations WHERE inventory_location_id IS NOT NULL)'
    INTO v_used;
  IF v_used THEN
    RAISE NOTICE 'R&W isolation: rw_locations.inventory_location_id has data; column kept.';
  ELSE
    ALTER TABLE public.rw_locations DROP COLUMN inventory_location_id;
  END IF;
END $$;
