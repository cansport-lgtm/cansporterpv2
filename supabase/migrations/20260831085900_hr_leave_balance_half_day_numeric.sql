-- v1 tracks half-day leave in 0.5 increments (e.g. 0.5 used / 7.5 remaining) but the
-- v2 columns were integer, which would have rounded and corrupted staff balances on import.
-- Widen to numeric(5,1), matching the sibling total_used / remaining columns.
ALTER TABLE public.employee_leave_balances
  ALTER COLUMN half_day_allocated TYPE numeric(5,1),
  ALTER COLUMN half_day_used      TYPE numeric(5,1),
  ALTER COLUMN half_day_remaining TYPE numeric(5,1);
