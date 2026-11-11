-- Rollback for 20261120120000_grade_ledger_cutover_10_nov.sql
-- Puts the cutover date list back to 1 Sep / 1 Oct 2026. If the cutover has
-- already been moved to 10 Nov 2026 the ADD CONSTRAINT fails: set the cutover
-- back to an older date on Grade Ledger Setup first (unlock the opening
-- balances to do so), then run this.

ALTER TABLE public.grade_ledger_settings
  DROP CONSTRAINT IF EXISTS grade_ledger_settings_cutover_date_check;

ALTER TABLE public.grade_ledger_settings
  ADD CONSTRAINT grade_ledger_settings_cutover_date_check
  CHECK (cutover_date IN (DATE '2026-09-01', DATE '2026-10-01'));
