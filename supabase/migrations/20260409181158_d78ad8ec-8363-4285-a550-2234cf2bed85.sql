
-- Create production_sub_departments table
CREATE TABLE public.production_sub_departments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  code VARCHAR NOT NULL,
  name VARCHAR NOT NULL,
  sequence_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.production_sub_departments ENABLE ROW LEVEL SECURITY;

-- RLS policies (anon role, matching existing pattern)
CREATE POLICY "Allow all select on production_sub_departments" ON public.production_sub_departments FOR SELECT TO anon USING (true);
CREATE POLICY "Allow all insert on production_sub_departments" ON public.production_sub_departments FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow all update on production_sub_departments" ON public.production_sub_departments FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on production_sub_departments" ON public.production_sub_departments FOR DELETE TO anon USING (true);

-- Add sub_department_id to production_entries
ALTER TABLE public.production_entries ADD COLUMN sub_department_id UUID REFERENCES public.production_sub_departments(id) ON DELETE SET NULL;
