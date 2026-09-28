-- Rollback for 20260928120100_gate_pass.sql
-- Drops the Gate Pass module. This DELETES every gate pass and its history.
-- Left as they are:
--   * stock_movements rows posted for samples (reference_type = 'gate_pass'):
--     they record goods that really left; delete them by hand if needed.
--   * sales_dispatches set to 'in_transit' when their vehicle went out.
--   * the four app_role values from 20260928120000_gate_pass_roles.sql:
--     Postgres cannot drop enum values. Remove the user_roles rows instead.

DROP FUNCTION IF EXISTS public.gate_pass_release(uuid, text);
DROP FUNCTION IF EXISTS public.gate_pass_gate_check(uuid, jsonb, text, text);
DROP FUNCTION IF EXISTS public.gate_pass_mark_out(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_refresh(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_remove_dispatch(uuid, uuid);
DROP FUNCTION IF EXISTS public.gate_pass_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.gate_pass_review(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.gate_pass_submit(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_save(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.gate_pass_build_sample(uuid, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_build_supplier_return(uuid, uuid);
DROP FUNCTION IF EXISTS public.gate_pass_sync_sales(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_build_sales(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.gate_pass_notify(public.gate_passes, text, text, text, boolean, boolean);
DROP FUNCTION IF EXISTS public.gate_pass_expected(public.gate_pass_items);
DROP FUNCTION IF EXISTS public.gate_pass_norm_vehicle(text);
DROP FUNCTION IF EXISTS public.gate_pass_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_can(text);
DROP FUNCTION IF EXISTS public.gate_pass_has_any_role(text[]);

DROP VIEW IF EXISTS public.v_gate_pass_fg_samples;
DROP VIEW IF EXISTS public.v_dispatch_gate_pass;

DROP TABLE IF EXISTS public.gate_pass_events;
DROP TABLE IF EXISTS public.gate_pass_dispatches;
DROP TABLE IF EXISTS public.gate_pass_items;
DROP TABLE IF EXISTS public.gate_passes;
DROP SEQUENCE IF EXISTS public.gate_pass_number_seq;
