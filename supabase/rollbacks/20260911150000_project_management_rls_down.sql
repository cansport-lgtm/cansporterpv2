-- Rollback for 20260911150000_project_management_rls.sql
-- Restores the previous permissive policies. The storage bucket is left
-- in place (deleting it would orphan uploaded files) but made public
-- again to match the pre-migration declaration.

DROP POLICY IF EXISTS "Managers and super admins can view projects" ON public.projects;
DROP POLICY IF EXISTS "Logged-in users can create projects" ON public.projects;
DROP POLICY IF EXISTS "Managers and super admins can update projects" ON public.projects;
DROP POLICY IF EXISTS "Super admins can delete projects" ON public.projects;
CREATE POLICY "Allow all access to projects" ON public.projects FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Project members can view tasks" ON public.project_tasks;
DROP POLICY IF EXISTS "Project members can create tasks" ON public.project_tasks;
DROP POLICY IF EXISTS "Project members can update tasks" ON public.project_tasks;
DROP POLICY IF EXISTS "Super admins can delete tasks" ON public.project_tasks;
CREATE POLICY "Allow all access to project_tasks" ON public.project_tasks FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Project members can view documents" ON public.project_documents;
DROP POLICY IF EXISTS "Project members can add documents" ON public.project_documents;
DROP POLICY IF EXISTS "Project members can delete documents" ON public.project_documents;
CREATE POLICY "Allow all access to project_documents" ON public.project_documents FOR ALL USING (true) WITH CHECK (true);

DROP FUNCTION IF EXISTS public.can_access_project(UUID);

-- Restore the non-SECURITY DEFINER numbering function
CREATE OR REPLACE FUNCTION public.generate_project_number()
RETURNS TRIGGER AS $$
DECLARE
  v_year TEXT;
  v_max_num INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');

  SELECT COALESCE(MAX(
    CASE
      WHEN project_number LIKE 'PRJ-' || v_year || '-%'
      THEN NULLIF(SUBSTRING(project_number FROM 8), '')::INTEGER
      ELSE 0
    END
  ), 0) + 1 INTO v_max_num
  FROM projects
  WHERE project_number LIKE 'PRJ-' || v_year || '-%';

  NEW.project_number := 'PRJ-' || v_year || '-' || LPAD(v_max_num::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

UPDATE storage.buckets SET public = true WHERE id = 'project-documents';
