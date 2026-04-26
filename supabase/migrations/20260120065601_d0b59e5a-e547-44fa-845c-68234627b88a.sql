-- Add salary fields to employees table
ALTER TABLE public.employees 
ADD COLUMN IF NOT EXISTS basic_salary numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS allowances numeric DEFAULT 0;