-- Rollback for 20261116120000_mph_fixed_daily_allowance.sql
-- Drops the fixed daily MPH allowance columns. Authorized MPH goes back to
-- output × MPH number only.

ALTER TABLE public.mph_calculating_numbers
  DROP CONSTRAINT IF EXISTS mph_calculating_numbers_daily_fixed_mph_check;
ALTER TABLE public.mph_calculating_numbers
  DROP COLUMN IF EXISTS daily_fixed_mph,
  DROP COLUMN IF EXISTS fixed_mph_effective_from;
