-- ============================================================================
-- Gate Pass: one approver role per pass type
-- ----------------------------------------------------------------------------
--   gate_pass_sample_manager     → approve / reject Sample passes
--   gate_pass_returnable_manager → approve / reject Returnable passes
--   gate_pass_jobwork_manager    → approve / reject Job work passes
--   gate_pass_scrap_manager      → approve / reject Scrap passes (sees scrap rates)
--
-- gate_pass_manager no longer approves these four types; it keeps cancel,
-- release, close, manual backfill and paper books. Functions are in
-- 20260930120100_gate_pass_type_managers.sql (enum values can't be used in the
-- transaction that adds them).
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_sample_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_returnable_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_jobwork_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'gate_pass_scrap_manager';
