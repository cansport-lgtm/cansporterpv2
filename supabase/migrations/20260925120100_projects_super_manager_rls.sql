-- ============================================================
-- Project Management module — Projects Super Manager access
--
-- projects_super_manager can:
--   * view every project, task and document (not just ones where
--     they are project_manager_id)
--   * create projects (already open to any logged-in user), create and
--     update tasks on any project (Kanban progress), upload documents
-- and can NOT:
--   * edit project records (super_admin only, see
--     20260919120000_projects_manager_no_edit.sql)
--   * delete projects or tasks (already super_admin only)
--   * delete documents — tightened below, since project members could
--     otherwise delete documents on any project they can access
-- ============================================================

-- Access helper now also admits the super manager. Task SELECT/INSERT/UPDATE
-- and document SELECT/INSERT policies all go through this.
CREATE OR REPLACE FUNCTION public.can_access_project(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(public.app_user_id(), 'super_admin'::app_role)
      OR public.has_role(public.app_user_id(), 'projects_super_manager'::app_role)
      OR EXISTS (
           SELECT 1 FROM public.projects p
           WHERE p.id = p_project_id
             AND p.project_manager_id = public.app_user_id()
         )
$$;

-- ------------------------------------------------------------
-- projects: super manager can view all
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Managers and super admins can view projects" ON public.projects;

CREATE POLICY "Managers and super admins can view projects"
  ON public.projects FOR SELECT
  USING (
    project_manager_id = public.app_user_id()
    OR public.has_role(public.app_user_id(), 'super_admin'::app_role)
    OR public.has_role(public.app_user_id(), 'projects_super_manager'::app_role)
  );

-- ------------------------------------------------------------
-- project_documents: super manager never deletes
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Project members can delete documents" ON public.project_documents;

CREATE POLICY "Project members can delete documents"
  ON public.project_documents FOR DELETE
  USING (
    public.has_role(public.app_user_id(), 'super_admin'::app_role)
    OR (
      public.can_access_project(project_id)
      AND NOT public.has_role(public.app_user_id(), 'projects_super_manager'::app_role)
    )
  );
