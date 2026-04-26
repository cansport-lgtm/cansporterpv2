
-- Skilled Labour Planning: track available/required workers per process per department
CREATE TABLE public.skilled_labour_planning (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID REFERENCES public.production_departments(id),
  process_id UUID REFERENCES public.qa_processes(id),
  process_name TEXT NOT NULL,
  available_workers INTEGER NOT NULL DEFAULT 0,
  required_workers INTEGER NOT NULL DEFAULT 0,
  to_train INTEGER NOT NULL DEFAULT 0,
  to_hire INTEGER NOT NULL DEFAULT 0,
  output_per_worker_per_day NUMERIC NOT NULL DEFAULT 0,
  output_unit TEXT DEFAULT 'dozens',
  remarks TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id)
);

-- Enable RLS
ALTER TABLE public.skilled_labour_planning ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read
CREATE POLICY "Allow read access to skilled_labour_planning"
ON public.skilled_labour_planning FOR SELECT
USING (true);

-- Allow insert/update/delete for authenticated users
CREATE POLICY "Allow insert to skilled_labour_planning"
ON public.skilled_labour_planning FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow update to skilled_labour_planning"
ON public.skilled_labour_planning FOR UPDATE
USING (true);

CREATE POLICY "Allow delete to skilled_labour_planning"
ON public.skilled_labour_planning FOR DELETE
USING (true);

-- Auto-update timestamp
CREATE TRIGGER update_skilled_labour_planning_updated_at
BEFORE UPDATE ON public.skilled_labour_planning
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
