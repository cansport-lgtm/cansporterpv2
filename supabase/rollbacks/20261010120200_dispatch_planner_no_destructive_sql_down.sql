-- Rollback for 20261010120200_dispatch_planner_no_destructive_sql.sql
-- Restores nothing by itself: after running this, re-run the function
-- definitions in 20261010120100_dispatch_planner.sql if the module is to keep
-- working, or run 20261010120100_dispatch_planner_down.sql to remove the module.

DROP FUNCTION IF EXISTS public.dispatch_planner_version_archive(uuid);
DROP FUNCTION IF EXISTS public.dispatch_planner_pins_cleanup();
DROP FUNCTION IF EXISTS public.dispatch_planner_pin_clear(uuid);
DROP FUNCTION IF EXISTS public.dispatch_planner_pin_save(uuid, date, boolean, text);
DROP FUNCTION IF EXISTS public.dispatch_planner_suggest(date, date);
DROP TYPE IF EXISTS public.dispatch_planner_suggest_row;

ALTER TABLE public.dispatch_planner_versions DROP COLUMN IF EXISTS archived_by;
ALTER TABLE public.dispatch_planner_versions DROP COLUMN IF EXISTS archived_at;
ALTER TABLE public.dispatch_planner_pins DROP COLUMN IF EXISTS cleared_at;
