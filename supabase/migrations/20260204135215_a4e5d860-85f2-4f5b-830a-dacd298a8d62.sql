-- Create table for process-wise productivity targets
CREATE TABLE public.labour_process_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_id UUID NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.production_departments(id) ON DELETE SET NULL,
  full_day_target INTEGER NOT NULL DEFAULT 0,
  half_day_target INTEGER GENERATED ALWAYS AS (full_day_target / 2) STORED,
  target_unit VARCHAR(50) DEFAULT 'pcs',
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_active BOOLEAN DEFAULT true,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id),
  UNIQUE(process_id, department_id, effective_from)
);

-- Enable RLS
ALTER TABLE public.labour_process_targets ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow all access for authenticated users" 
ON public.labour_process_targets 
FOR ALL 
USING (true);

-- Create trigger for updated_at
CREATE TRIGGER update_labour_process_targets_updated_at
BEFORE UPDATE ON public.labour_process_targets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Add index for faster lookups
CREATE INDEX idx_labour_process_targets_process ON public.labour_process_targets(process_id);
CREATE INDEX idx_labour_process_targets_active ON public.labour_process_targets(is_active, effective_from);