-- Rollback for 20261010120000_store_pass_one_to_one.sql
-- Re-apply 20261009130000_store_pass_link_roles.sql (store_pass_link_dispatches,
-- store_pass_attach_dispatch: several dispatches per pass, any linker role may
-- change links) and section gate_pass_build_sales of
-- 20260928120100_gate_pass.sql (several dispatches per sales gate pass, no
-- super admin rule). No data changes to undo: links made under the one-to-one
-- rule are valid under the old functions too.
SELECT 1;
