-- ============================================================================
-- Rejections & Wastage: back to the v1 module.
--
-- The module keeps exactly the seven v1 tables, which this migration does not
-- alter:
--   rw_rejections, rw_leakages, rw_wastages,
--   rw_reasons, rw_materials, rw_units, rw_dispositions
--
-- Everything v2 layered on top from 30 Aug 2026 (the "ball inventory" build and
-- the downgrade forms) is removed: nine tables, their functions, triggers and
-- auto-code series. The floor never adopted it (48 checker entries, the last on
-- 22 Sep 2026) and kept using the v1 per-material log.
--
-- Nothing is lost: each dropped table is first copied, rows and all, into the
-- rw_archive schema, which is not exposed through the API.
--
-- Masters go back to their v1 content: the v2 test rows are removed and the
-- dispositions are the v1 five again.
--
-- Plan: docs/RW_V1_PARITY_PLAN.md. Rollback:
-- supabase/rollbacks/20261118120000_rw_back_to_v1_down.sql.
-- Safe to re-run.
-- ============================================================================

-- 1. Archive ----------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS rw_archive;
REVOKE ALL ON SCHEMA rw_archive FROM PUBLIC, anon, authenticated;

COMMENT ON SCHEMA rw_archive IS
  'Read-only copies of the R&W ball-inventory and downgrade tables dropped by 20261118120000_rw_back_to_v1. Not used by the app.';

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rw_checker_entries', 'rw_checker_entry_intervals',
    'rw_ball_ledger', 'rw_ball_stock',
    'rw_locations', 'rw_defect_grades', 'rw_department_defect_grades', 'rw_defect_rates',
    'rw_downgrades'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL AND to_regclass('rw_archive.' || t) IS NULL THEN
      EXECUTE format('CREATE TABLE rw_archive.%I AS TABLE public.%I', t, t);
    END IF;
  END LOOP;
END $$;

-- Master rows removed in step 4 are kept here as JSON.
CREATE TABLE IF NOT EXISTS rw_archive.removed_masters (
  source_table text NOT NULL,
  row_data jsonb NOT NULL,
  action text NOT NULL,
  removed_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Drop the downgrade forms -------------------------------------------------

DROP FUNCTION IF EXISTS public.rw_downgrade_cancel(uuid);
DROP FUNCTION IF EXISTS public.rw_downgrade_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.rw_downgrade_submit(text, uuid, uuid, text, numeric, text, uuid, uuid, text, text, text, numeric, numeric);
DO $$
BEGIN
  -- Its first argument is the table's row type, so it must go before the table.
  IF to_regclass('public.rw_downgrades') IS NOT NULL THEN
    DROP FUNCTION IF EXISTS public.rw_downgrade_notify(public.rw_downgrades, text, text, text, boolean, boolean);
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.rw_downgrade_can(text);

DROP TABLE IF EXISTS public.rw_downgrades;
DROP SEQUENCE IF EXISTS public.rw_downgrade_seq;

DELETE FROM public.notifications WHERE reference_type = 'rw_downgrade';

-- 3. Drop the ball inventory ----------------------------------------------------

-- Views were already removed by 20260923120000; listed for databases that
-- skipped it.
DROP VIEW IF EXISTS public.v_rw_posted_entry_conflicts;
DROP VIEW IF EXISTS public.v_rw_output_reconciliation;
DROP VIEW IF EXISTS public.v_rw_leaker_wip_reconciliation;
DROP VIEW IF EXISTS public.v_rw_unlinked_models;
DROP VIEW IF EXISTS public.v_rw_defect_vs_production;
DROP VIEW IF EXISTS public.v_rw_entry_coverage;

DROP TRIGGER IF EXISTS trg_production_entries_apportion ON public.production_entries;

-- Children first. Each table's own triggers go with it.
DROP TABLE IF EXISTS public.rw_checker_entry_intervals;
DROP TABLE IF EXISTS public.rw_checker_entries;
DROP TABLE IF EXISTS public.rw_ball_stock;
DROP TABLE IF EXISTS public.rw_ball_ledger;
DROP TABLE IF EXISTS public.rw_defect_rates;
DROP TABLE IF EXISTS public.rw_department_defect_grades;
DROP TABLE IF EXISTS public.rw_defect_grades;
DROP TABLE IF EXISTS public.rw_locations;

DROP FUNCTION IF EXISTS public.rw_production_entry_after_change();
DROP FUNCTION IF EXISTS public.rw_derive_production_rejected();
DROP FUNCTION IF EXISTS public.rw_apportion_production_rejected(date, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rw_sync_production_rejected(date, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rw_defect_qty_for_production(date, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rw_is_defect_output_grade(uuid);
DROP FUNCTION IF EXISTS public.rw_check_interval_sum();
DROP FUNCTION IF EXISTS public.rw_post_checker_entry();
DROP FUNCTION IF EXISTS public.rw_ball_ledger_after_change();
DROP FUNCTION IF EXISTS public.rw_rebuild_ball_series(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.rw_defect_standard_cost(uuid, uuid);
DROP FUNCTION IF EXISTS public.rw_ball_cutover();

-- The auto-code series for the two dropped masters (20261021120000).
DELETE FROM public.auto_code_series WHERE entity IN ('rw_locations', 'rw_defect_grades');

-- 4. Masters back to v1 ---------------------------------------------------------
-- A row that an entry still points at is deactivated instead of deleted.

DO $$
DECLARE
  r record;
  v_used boolean;
BEGIN
  -- Reasons: the v2 test row.
  FOR r IN SELECT * FROM public.rw_reasons WHERE lower(btrim(name)) = 'test' LOOP
    SELECT EXISTS (SELECT 1 FROM public.rw_rejections WHERE reason_id = r.id)
        OR EXISTS (SELECT 1 FROM public.rw_wastages   WHERE reason_id = r.id)
        OR EXISTS (SELECT 1 FROM public.rw_leakages   WHERE reason_id = r.id)
      INTO v_used;
    INSERT INTO rw_archive.removed_masters (source_table, row_data, action)
    VALUES ('rw_reasons', to_jsonb(r), CASE WHEN v_used THEN 'deactivated' ELSE 'deleted' END);
    IF v_used THEN
      UPDATE public.rw_reasons SET is_active = false WHERE id = r.id;
    ELSE
      DELETE FROM public.rw_reasons WHERE id = r.id;
    END IF;
  END LOOP;

  -- Units: v1 has pcs, dozen, kg, gram, ltr.
  FOR r IN SELECT * FROM public.rw_units WHERE symbol IN ('TEST', 'UNIT') LOOP
    SELECT EXISTS (SELECT 1 FROM public.rw_rejections WHERE unit = r.symbol)
        OR EXISTS (SELECT 1 FROM public.rw_wastages   WHERE unit = r.symbol)
        OR EXISTS (SELECT 1 FROM public.rw_leakages   WHERE unit = r.symbol)
        OR EXISTS (SELECT 1 FROM public.rw_materials  WHERE unit = r.symbol)
      INTO v_used;
    INSERT INTO rw_archive.removed_masters (source_table, row_data, action)
    VALUES ('rw_units', to_jsonb(r), CASE WHEN v_used THEN 'deactivated' ELSE 'deleted' END);
    IF v_used THEN
      UPDATE public.rw_units SET is_active = false WHERE id = r.id;
    ELSE
      DELETE FROM public.rw_units WHERE id = r.id;
    END IF;
  END LOOP;

  -- Dispositions: v1 has Scrap, Rework, Use-as-is, Return to Supplier, Quarantine.
  FOR r IN SELECT * FROM public.rw_dispositions WHERE name = 'Down grade conversion' LOOP
    SELECT EXISTS (SELECT 1 FROM public.rw_rejections WHERE disposition_id = r.id)
        OR EXISTS (SELECT 1 FROM public.rw_wastages   WHERE disposition_id = r.id)
        OR EXISTS (SELECT 1 FROM public.rw_leakages   WHERE disposition_id = r.id)
      INTO v_used;
    INSERT INTO rw_archive.removed_masters (source_table, row_data, action)
    VALUES ('rw_dispositions', to_jsonb(r), CASE WHEN v_used THEN 'deactivated' ELSE 'deleted' END);
    IF v_used THEN
      UPDATE public.rw_dispositions SET is_active = false WHERE id = r.id;
    ELSE
      DELETE FROM public.rw_dispositions WHERE id = r.id;
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM public.rw_dispositions WHERE name = 'Quarantine to store' LOOP
    IF NOT EXISTS (SELECT 1 FROM public.rw_dispositions WHERE name = 'Quarantine') THEN
      INSERT INTO rw_archive.removed_masters (source_table, row_data, action)
      VALUES ('rw_dispositions', to_jsonb(r), 'renamed to Quarantine');
      UPDATE public.rw_dispositions SET name = 'Quarantine' WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
