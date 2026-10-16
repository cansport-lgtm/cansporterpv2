-- Rollback for 20261008120100_store_pass.sql
-- Drops the Store Pass module. This DELETES every store pass and its history.
-- Left as they are:
--   * the three app_role values from 20261008120000_store_pass_roles.sql:
--     Postgres cannot drop enum values. Remove the user_roles rows instead.
--   * system_notifications rows with module 'store_pass'.
-- Nothing in dispatches or gate passes was changed by the module.

DROP FUNCTION IF EXISTS public.store_pass_refresh(uuid);
DROP FUNCTION IF EXISTS public.store_pass_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.store_pass_issue(uuid);
DROP FUNCTION IF EXISTS public.store_pass_save(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.store_pass_current_lines(uuid);
DROP FUNCTION IF EXISTS public.store_pass_build(uuid, uuid[], jsonb);
DROP FUNCTION IF EXISTS public.store_pass_notify(public.store_passes, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.store_pass_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.store_pass_can(text);
DROP FUNCTION IF EXISTS public.store_pass_has_any_role(text[]);

DROP VIEW IF EXISTS public.v_store_gate_tracking;
DROP VIEW IF EXISTS public.v_dispatch_store_pass;

DROP TABLE IF EXISTS public.store_pass_events;
DROP TABLE IF EXISTS public.store_pass_items;
DROP TABLE IF EXISTS public.store_pass_dispatches;
DROP TABLE IF EXISTS public.store_passes;
DROP SEQUENCE IF EXISTS public.store_pass_number_seq;
