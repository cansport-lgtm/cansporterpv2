
-- Create dedicated departments table for 5S module
CREATE TABLE public.five_s_departments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sequence_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.five_s_departments ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Authenticated users can view 5S departments"
  ON public.five_s_departments FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert 5S departments"
  ON public.five_s_departments FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update 5S departments"
  ON public.five_s_departments FOR UPDATE
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete 5S departments"
  ON public.five_s_departments FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- Copy existing referenced departments from production_departments into five_s_departments (keeping same IDs)
INSERT INTO public.five_s_departments (id, code, name, sequence_order, is_active)
SELECT pd.id, pd.code, pd.name, pd.sequence_order, pd.is_active
FROM public.production_departments pd
WHERE pd.id IN (
  SELECT DISTINCT department_id FROM public.five_s_audits WHERE department_id IS NOT NULL
  UNION
  SELECT DISTINCT department_id FROM public.five_s_action_items WHERE department_id IS NOT NULL
);

-- Drop existing FK constraints
ALTER TABLE public.five_s_audits
  DROP CONSTRAINT IF EXISTS five_s_audits_department_id_fkey;

ALTER TABLE public.five_s_action_items
  DROP CONSTRAINT IF EXISTS five_s_action_items_department_id_fkey;

-- Add new FK constraints pointing to five_s_departments
ALTER TABLE public.five_s_audits
  ADD CONSTRAINT five_s_audits_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES public.five_s_departments(id);

ALTER TABLE public.five_s_action_items
  ADD CONSTRAINT five_s_action_items_department_id_fkey
  FOREIGN KEY (department_id) REFERENCES public.five_s_departments(id);
