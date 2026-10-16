-- ============================================================================
-- Labour Gate Pass: approver role
-- ----------------------------------------------------------------------------
--   labour_gate_pass_approver → approve / reject worker gate passes, cancel any
--                               pass before it is out, convert an overdue short
--                               leave to a half day, see the register.
--
-- The tables and functions are added in 20261002120100_labour_gate_pass.sql —
-- a new enum value can't be referenced in the transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'labour_gate_pass_approver';
