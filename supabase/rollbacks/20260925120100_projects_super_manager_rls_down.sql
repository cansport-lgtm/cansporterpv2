-- Rollback for 20260925120100_projects_super_manager_rls.sql
-- Restores the pre-super-manager project access rules. (The
-- 'projects_super_manager' enum value itself can't be dropped from app_role.)

CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(public.app_user_id(), 'super_admin'::app_role)
      OR EXISTS (
           SELECT 1 FROM public.projects p
           WHERE p.id = p_project_id
             AND p.project_manager_id = public.app_user_id()
         )
$$;

DROP POLICY IF EXISTS "Managers and super admins can view projects" ON public.projects;

CREATE POLICY "Managers and super admins can view projects"
  ON public.projects FOR SELECT
  USING (
    project_manager_id = public.app_user_id()
    OR public.has_role(public.app_user_id(), 'super_admin'::app_role)
  );

DROP POLICY IF EXISTS "Project members can delete documents" ON public.project_documents;

CREATE POLICY "Project members can delete documents"
  ON public.project_documents FOR DELETE
  USING (public.can_access_project(project_id));
