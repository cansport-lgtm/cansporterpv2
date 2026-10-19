-- ============================================================================
-- Production Coordinator role
-- ----------------------------------------------------------------------------
--   production_coordinator → when production is posted for a date, gives the
--                            reason(s) for every department that used more MPH
--                            than it earned, submits them and prints the report.
--
-- Confined to MPH Loss Reasons + MPH Analysis (enforced in the app). The
-- tables and functions are added in 20261102120100_mph_loss_reasons.sql — a
-- new enum value can't be referenced in the transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_coordinator';
