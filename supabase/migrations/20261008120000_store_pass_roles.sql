-- ============================================================================
-- Store Pass roles
-- ----------------------------------------------------------------------------
-- Standard three-tier set for the new Store Pass module (finished goods handed
-- over by the store for dispatch, reconciled daily against the gate):
--
--   store_pass_manager → make and issue passes, cancel an issued pass, explain
--                        reconciliation discrepancies
--   store_pass_officer → the store keeper: make, issue and print passes,
--                        edit / cancel own drafts
--   store_pass_viewer  → read only
--
-- The tables and functions are added in 20261008120100_store_pass.sql — the
-- new enum values can't be referenced in the same transaction that adds them.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'store_pass_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'store_pass_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'store_pass_viewer';
