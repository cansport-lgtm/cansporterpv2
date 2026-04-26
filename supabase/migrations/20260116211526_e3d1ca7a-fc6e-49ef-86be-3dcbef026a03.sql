-- Add monthly_salary column to labour_employees table
ALTER TABLE public.labour_employees
ADD COLUMN monthly_salary NUMERIC(10, 2) DEFAULT 0;

-- Add comment for clarity
COMMENT ON COLUMN public.labour_employees.monthly_salary IS 'Monthly salary in PKR';