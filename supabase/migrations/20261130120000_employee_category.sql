-- Employee category: permanent or probation.
-- Only permanent employees will receive the monthly leave quota (applied in a later change).
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS employment_category text NOT NULL DEFAULT 'permanent';

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_employment_category_check;
ALTER TABLE public.employees
  ADD CONSTRAINT employees_employment_category_check
  CHECK (employment_category IN ('permanent', 'probation'));

-- Backfill: anyone already flagged as probation in status keeps that meaning.
UPDATE public.employees
SET employment_category = 'probation'
WHERE status = 'probation';
