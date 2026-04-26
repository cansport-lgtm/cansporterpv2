
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS half_day_leaves integer DEFAULT 0;

ALTER TABLE public.employee_leave_balances 
  ADD COLUMN IF NOT EXISTS half_day_allocated integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS half_day_used integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS half_day_remaining integer DEFAULT 0;
