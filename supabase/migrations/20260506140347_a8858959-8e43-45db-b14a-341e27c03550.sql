ALTER TABLE public.employee_leave_balances
  ALTER COLUMN half_day_allocated TYPE numeric(5,1) USING half_day_allocated::numeric,
  ALTER COLUMN half_day_used      TYPE numeric(5,1) USING half_day_used::numeric,
  ALTER COLUMN half_day_remaining TYPE numeric(5,1) USING half_day_remaining::numeric;

UPDATE public.employee_leave_balances
SET half_day_used = 0.5, half_day_remaining = half_day_allocated - 0.5
WHERE employee_id = 'b72c4790-fd49-49bf-914f-c11f48dbe3c0' AND year = 2026;