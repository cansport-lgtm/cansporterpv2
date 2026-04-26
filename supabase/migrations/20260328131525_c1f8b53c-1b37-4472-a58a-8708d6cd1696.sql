ALTER TABLE public.salary_locks ADD COLUMN module text NOT NULL DEFAULT 'hr';

-- Drop old unique constraint if exists and create new one with module
ALTER TABLE public.salary_locks DROP CONSTRAINT IF EXISTS salary_locks_lock_month_lock_year_key;
ALTER TABLE public.salary_locks ADD CONSTRAINT salary_locks_module_month_year_key UNIQUE (module, lock_month, lock_year);