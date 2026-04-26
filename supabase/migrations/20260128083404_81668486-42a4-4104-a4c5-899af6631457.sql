-- Add employee_type and per_day_wages columns to labour_employees
ALTER TABLE public.labour_employees 
ADD COLUMN employee_type text NOT NULL DEFAULT 'salary' CHECK (employee_type IN ('salary', 'daily_wages')),
ADD COLUMN per_day_wages numeric DEFAULT 0;