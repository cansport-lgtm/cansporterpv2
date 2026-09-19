-- ============================================================
-- Project Management module — managers can create, not edit/delete
--
-- 20260911150000_project_management_rls.sql let whichever user was
-- assigned as a project's project_manager_id also UPDATE that project.
-- That allows a manager to edit projects they're assigned to, which the
-- app no longer wants: managers (and everyone else) should only be able
-- to create projects; editing and deleting are super_admin-only, same
-- as delete already was.
-- ============================================================

DROP POLICY IF EXISTS "Managers and super admins can update projects" ON public.projects;

CREATE POLICY "Super admins can update projects"
  ON public.projects FOR UPDATE
  USING (public.has_role(public.app_user_id(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(public.app_user_id(), 'super_admin'::app_role));
