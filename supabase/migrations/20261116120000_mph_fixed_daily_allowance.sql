-- ============================================================
-- MPH: fixed daily allowance per department
--
-- Authorized MPH is earned only from output (quantity × MPH number), so a
-- department with no countable output — housekeeping, for one — earns 0 and
-- every MPH deployed there shows as a loss that the Production Coordinator
-- has to explain, every day, with a made-up reason.
--
-- A department-level MPH Master row (sub_department_id NULL) can now carry a
-- fixed number of MPH that the department earns per working day, in addition
-- to any output-based MPH:
--
--   Authorized = Σ quantity_produced × mph_number + daily_fixed_mph
--
-- Rules (src/lib/mphLoss.ts):
--   • The allowance counts only on a date where the department has at least
--     one deployed worker (labour_productivity_targets row). A day nobody is
--     deployed earns nothing.
--   • It is a flat figure per day, not per worker, so over-staffing still
--     shows as a loss.
--   • It applies from fixed_mph_effective_from (NULL = always). Set this to
--     the go-live date so earlier days keep the figures they were saved with.
--
-- Rollback: supabase/rollbacks/20261116120000_mph_fixed_daily_allowance_down.sql
-- ============================================================

ALTER TABLE public.mph_calculating_numbers
  ADD COLUMN IF NOT EXISTS daily_fixed_mph numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fixed_mph_effective_from date;

ALTER TABLE public.mph_calculating_numbers
  DROP CONSTRAINT IF EXISTS mph_calculating_numbers_daily_fixed_mph_check;
ALTER TABLE public.mph_calculating_numbers
  ADD CONSTRAINT mph_calculating_numbers_daily_fixed_mph_check
  CHECK (daily_fixed_mph >= 0 AND (daily_fixed_mph = 0 OR sub_department_id IS NULL));

COMMENT ON COLUMN public.mph_calculating_numbers.daily_fixed_mph IS
  'MPH the department earns per day it has anyone deployed, on top of output × mph_number. Department-level rows only.';
COMMENT ON COLUMN public.mph_calculating_numbers.fixed_mph_effective_from IS
  'First date the fixed daily MPH applies (NULL = always).';
