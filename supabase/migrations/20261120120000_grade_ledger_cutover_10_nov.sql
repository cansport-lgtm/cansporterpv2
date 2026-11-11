-- ============================================================================
-- Grade stage ledger: allow 10 Nov 2026 as the cutover date.
--
-- The ledger went live with a 1 Sep 2026 cutover and no opening balances, so
-- the Sep–Nov book balances never matched the floor. The count is being taken
-- as the stock at the start of 10 Nov 2026 instead, and the ledger restarts
-- from there: v_grade_ledger_movements only reads documents dated on/after the
-- cutover, so earlier production entries simply stop counting. Nothing is
-- deleted and production_entries is not touched.
--
-- This only widens the list of allowed dates. A super admin still has to pick
-- the new date on Grade Ledger Setup and enter the opening balances.
-- ============================================================================

ALTER TABLE public.grade_ledger_settings
  DROP CONSTRAINT IF EXISTS grade_ledger_settings_cutover_date_check;

ALTER TABLE public.grade_ledger_settings
  ADD CONSTRAINT grade_ledger_settings_cutover_date_check
  CHECK (cutover_date IN (DATE '2026-09-01', DATE '2026-10-01', DATE '2026-11-10'));
