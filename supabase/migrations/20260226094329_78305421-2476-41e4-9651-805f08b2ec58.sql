
-- Create production_targets table to store default targets per department+grade
CREATE TABLE public.production_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES public.production_departments(id),
  grade_id UUID NOT NULL REFERENCES public.grades(id),
  target_quantity INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(department_id, grade_id)
);

-- Enable RLS with permissive policies (custom auth system)
ALTER TABLE public.production_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all read access on production_targets"
  ON public.production_targets FOR SELECT USING (true);

CREATE POLICY "Allow all insert access on production_targets"
  ON public.production_targets FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow all update access on production_targets"
  ON public.production_targets FOR UPDATE USING (true);

CREATE POLICY "Allow all delete access on production_targets"
  ON public.production_targets FOR DELETE USING (true);
