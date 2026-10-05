-- Rollback for 20261009120000_store_pass_simplify.sql
-- Restores the Step 1 / Step 2 functions and view (dispatch-snapshot lines,
-- vehicle on the pass). Passes made with the simplified form keep their
-- dispatch_plan_no column (left in place) and their free-text lines; such lines
-- have NULL dispatch_id / dispatch_quantity, which the old functions never
-- produce but tolerate for reading. Re-apply 20261008120100_store_pass.sql
-- sections 2–5 and 20261008120200_store_pass_reconciliation.sql section 3
-- after running this file to get the old definitions back in full.

DROP FUNCTION IF EXISTS public.store_pass_link_dispatches(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.store_pass_clear_links(uuid);
DROP FUNCTION IF EXISTS public.store_pass_match_dispatch(text);
DROP FUNCTION IF EXISTS public.store_pass_unlinked(date, date);
DROP FUNCTION IF EXISTS public.store_pass_build(uuid, jsonb);
DROP FUNCTION IF EXISTS public.store_pass_reconcile(date, date);
DROP FUNCTION IF EXISTS public.store_pass_reconcile_products(date, date);
DROP FUNCTION IF EXISTS public.store_pass_save(uuid, jsonb, boolean);
DROP FUNCTION IF EXISTS public.store_pass_issue(uuid);
DROP VIEW IF EXISTS public.v_store_gate_tracking;
DROP INDEX IF EXISTS public.store_passes_plan_idx;
-- The NOT NULL constraints on store_pass_items.dispatch_id / dispatch_quantity
-- are not restored: simplified passes would violate them.
