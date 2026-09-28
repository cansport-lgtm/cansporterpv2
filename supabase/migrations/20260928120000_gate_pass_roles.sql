-- ============================================================================
-- Gate Pass roles
-- ----------------------------------------------------------------------------
-- Standard three-tier set for the new Gate Pass module, plus the gate guard:
--
--   gate_pass_manager → create, approve, release held passes, cancel
--   gate_pass_officer → create and submit passes
--   gate_pass_viewer  → read only
--   gate_security     → Gate Check page only: count, mark Out or hold
--
-- The tables and functions are added in 20260928120100_gate_pass.sql — the
-- new enum values can't be referenced in the same transaction that adds them.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_viewer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_security';
