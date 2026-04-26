-- Create labour_employees table (if not exists)
CREATE TABLE IF NOT EXISTS public.labour_employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_code TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  department_id UUID REFERENCES public.production_departments(id),
  contact_number TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.labour_employees ENABLE ROW LEVEL SECURITY;

-- Drop policy if exists and recreate
DROP POLICY IF EXISTS "Allow all operations on labour_employees" ON public.labour_employees;
CREATE POLICY "Allow all operations on labour_employees" ON public.labour_employees FOR ALL USING (true) WITH CHECK (true);

-- Clear existing productivity data to allow FK change
DELETE FROM public.labour_productivity_targets;

-- Drop old FK and add new one
ALTER TABLE public.labour_productivity_targets 
DROP CONSTRAINT IF EXISTS labour_productivity_targets_employee_id_fkey;

ALTER TABLE public.labour_productivity_targets 
ADD CONSTRAINT labour_productivity_targets_employee_id_fkey 
FOREIGN KEY (employee_id) REFERENCES public.labour_employees(id);

-- Create updated_at trigger if not exists
DROP TRIGGER IF EXISTS update_labour_employees_updated_at ON public.labour_employees;
CREATE TRIGGER update_labour_employees_updated_at
BEFORE UPDATE ON public.labour_employees
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();