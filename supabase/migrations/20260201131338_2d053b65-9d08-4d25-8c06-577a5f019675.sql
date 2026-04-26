-- Add department and machine columns to production_planning_items for department-wise planning
ALTER TABLE public.production_planning_items 
ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.production_departments(id),
ADD COLUMN IF NOT EXISTS machine_id UUID REFERENCES public.machines(id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_planning_items_department ON public.production_planning_items(department_id);
CREATE INDEX IF NOT EXISTS idx_planning_items_machine ON public.production_planning_items(machine_id);