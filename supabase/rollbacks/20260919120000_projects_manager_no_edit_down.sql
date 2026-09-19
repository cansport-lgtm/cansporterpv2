-- Rollback for 20260919120000_projects_manager_no_edit.sql
-- Restores the assigned-manager-can-update policy.

DROP POLICY IF EXISTS "Super admins can update projects" ON public.projects;

CREATE POLICY "Managers and super admins can update projects"
  ON public.projects FOR UPDATE
  USING (
    project_manager_id = public.app_user_id()
    OR public.has_role(public.app_user_id(), 'super_admin'::app_role)
  )
  WITH CHECK (public.app_user_id() IS NOT NULL);
