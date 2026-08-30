-- ============================================================================
-- DOWN-migration for the R&W ball inventory (20260830120000..160000)
-- ----------------------------------------------------------------------------
-- Not in supabase/migrations on purpose: it must never run automatically.
-- Run manually only if Phase 1 has to be backed out. It removes everything the
-- five migrations added and restores production_entries to its prior behavior;
-- it does not touch any pre-existing table, and any checker counts entered
-- before the rollback are lost with the rw_* tables.
-- ============================================================================
BEGIN;

-- The one hook into a pre-existing table.
DROP TRIGGER IF EXISTS trg_production_entries_apportion ON public.production_entries;
DROP FUNCTION IF EXISTS public.rw_production_entry_after_change();

-- Views (depend on tables and functions).
DROP VIEW IF EXISTS public.v_rw_posted_entry_conflicts;
DROP VIEW IF EXISTS public.v_rw_output_reconciliation;
DROP VIEW IF EXISTS public.v_rw_leaker_wip_reconciliation;
DROP VIEW IF EXISTS public.v_rw_unlinked_models;
DROP VIEW IF EXISTS public.v_rw_defect_vs_production;
DROP VIEW IF EXISTS public.v_rw_entry_coverage;

-- Tables (CASCADE covers their own triggers and FKs among themselves).
DROP TABLE IF EXISTS public.rw_checker_entry_intervals;
DROP TABLE IF EXISTS public.rw_checker_entries;
DROP TABLE IF EXISTS public.rw_ball_stock;
DROP TABLE IF EXISTS public.rw_ball_ledger;
DROP TABLE IF EXISTS public.rw_defect_rates;
DROP TABLE IF EXISTS public.rw_department_defect_grades;
DROP TABLE IF EXISTS public.rw_defect_grades CASCADE;  -- self-FK covered_output_grade_id
DROP TABLE IF EXISTS public.rw_locations;

-- Functions.
DROP FUNCTION IF EXISTS public.rw_derive_production_rejected();  -- superseded helper, trigger already dropped
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

-- Migration-history rows, so a later db push can re-apply cleanly.
DELETE FROM supabase_migrations.schema_migrations
 WHERE version IN ('20260830120000','20260830130000','20260830140000',
                   '20260830150000','20260830160000');

COMMIT;
