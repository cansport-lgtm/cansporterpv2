
-- Create projects table
CREATE TABLE public.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','in_progress','on_hold','completed','cancelled')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  start_date DATE,
  target_end_date DATE,
  actual_end_date DATE,
  department_id UUID REFERENCES public.production_departments(id),
  project_manager_id UUID REFERENCES public.app_users(id),
  budget_estimated NUMERIC DEFAULT 0,
  budget_actual NUMERIC DEFAULT 0,
  methodology TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);

-- Create project_tasks table
CREATE TABLE public.project_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_number TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','review','done')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  assigned_to UUID REFERENCES public.app_users(id),
  start_date DATE,
  due_date DATE,
  completed_date DATE,
  is_milestone BOOLEAN DEFAULT false,
  milestone_name TEXT,
  depends_on_task_id UUID REFERENCES public.project_tasks(id),
  estimated_hours NUMERIC DEFAULT 0,
  actual_hours NUMERIC DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.project_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to project_tasks" ON public.project_tasks FOR ALL USING (true) WITH CHECK (true);

-- Create project_documents table
CREATE TABLE public.project_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  task_id UUID REFERENCES public.project_tasks(id),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  uploaded_by UUID REFERENCES public.app_users(id),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to project_documents" ON public.project_documents FOR ALL USING (true) WITH CHECK (true);

-- Auto-number function for project_number
CREATE OR REPLACE FUNCTION public.generate_project_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM projects
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  NEW.project_number := 'PRJ-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_project_number
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  WHEN (NEW.project_number IS NULL OR NEW.project_number = '')
  EXECUTE FUNCTION public.generate_project_number();

-- Storage bucket for project documents
INSERT INTO storage.buckets (id, name, public) VALUES ('project-documents', 'project-documents', true);

-- Storage RLS policies
CREATE POLICY "Allow public read project-documents" ON storage.objects FOR SELECT USING (bucket_id = 'project-documents');
CREATE POLICY "Allow authenticated upload project-documents" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'project-documents');
CREATE POLICY "Allow authenticated delete project-documents" ON storage.objects FOR DELETE USING (bucket_id = 'project-documents');

-- Updated_at triggers
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_project_tasks_updated_at BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
