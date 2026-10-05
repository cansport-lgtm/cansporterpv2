-- Rollback for 20261009120100_dispatch_planner.sql
-- Drops the Dispatch Planner module: its saved plan versions, pins, vehicle
-- master and settings. Nothing in sales orders, dispatches, stock closing or
-- job orders was changed by the module, so nothing else is touched.
-- Left as they are:
--   * the three app_role values from 20261009120000_dispatch_planner_roles.sql:
--     Postgres cannot drop enum values. Remove the user_roles rows instead.

DROP FUNCTION IF EXISTS public.dispatch_planner_settings_save(jsonb);
DROP FUNCTION IF EXISTS public.dispatch_planner_vehicle_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.dispatch_planner_version_delete(uuid);
DROP FUNCTION IF EXISTS public.dispatch_planner_version_save(date, date, text, jsonb);
DROP FUNCTION IF EXISTS public.dispatch_planner_pins_cleanup();
DROP FUNCTION IF EXISTS public.dispatch_planner_pin_clear(uuid);
DROP FUNCTION IF EXISTS public.dispatch_planner_pin_save(uuid, date, boolean, text);
DROP FUNCTION IF EXISTS public.dispatch_planner_suggest(date, date);
DROP FUNCTION IF EXISTS public.dispatch_planner_add_working_days(date, integer);
DROP FUNCTION IF EXISTS public.dispatch_planner_working_days(date, date);
DROP FUNCTION IF EXISTS public.dispatch_planner_today();
DROP FUNCTION IF EXISTS public.dispatch_planner_can(text);
DROP FUNCTION IF EXISTS public.dispatch_planner_has_any_role(text[]);

DROP VIEW IF EXISTS public.v_dispatch_planner_fg_stock;
DROP VIEW IF EXISTS public.v_dispatch_planner_pending_lines;

DROP TABLE IF EXISTS public.dispatch_planner_version_lines;
DROP TABLE IF EXISTS public.dispatch_planner_versions;
DROP SEQUENCE IF EXISTS public.dispatch_planner_version_seq;
DROP TABLE IF EXISTS public.dispatch_planner_pins;
DROP TABLE IF EXISTS public.dispatch_planner_vehicles;
DROP TABLE IF EXISTS public.dispatch_planner_settings;
