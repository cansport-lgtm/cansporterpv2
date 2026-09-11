-- ============================================================
-- Project Management module — scoped RLS
--
-- projects / project_tasks / project_documents previously had
-- "FOR ALL USING (true)" policies, so anyone holding the publishable
-- key could read and modify every project. This replaces them with
-- rules mirroring what the app already enforces client-side:
--   * super_admin: full access to everything
--   * other users: only projects where they are project_manager_id
--     (and those projects' tasks and documents)
--   * any logged-in user may create a project
--   * deleting projects or tasks: super_admin only
--
-- The acting user is resolved by app_user_id() from the x-app-user-id
-- header the frontend attaches to every request (the app uses its own
-- auth, so auth.uid() is always NULL — see
-- 20260901120000_super_admin_audit_trail.sql). The header is
-- client-supplied, so this is defense-in-depth consistent with the
-- app's custom-auth architecture, not a substitute for real
-- per-request authentication (that would require Supabase Auth).
--
-- Also repairs project document storage: the 'project-documents'
-- bucket from 20260331154705 never materialized in the live database
-- (uploads currently fail), and it was declared public. It is created
-- here as a PRIVATE bucket; the frontend now downloads via short-lived
-- signed URLs instead of permanent public URLs.
-- ============================================================

-- ------------------------------------------------------------
-- Helper: can the acting user access this project?
-- SECURITY DEFINER so task/document policies can consult projects
-- without recursing through the projects policies themselves.
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- projects
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to projects" ON public.projects;

CREATE POLICY "Managers and super admins can view projects"
  ON public.projects FOR SELECT
  USING (
    project_manager_id = public.app_user_id()
    OR public.has_role(public.app_user_id(), 'super_admin'::app_role)
  );

CREATE POLICY "Logged-in users can create projects"
  ON public.projects FOR INSERT
  WITH CHECK (public.app_user_id() IS NOT NULL);

-- WITH CHECK stays loose so a manager can hand a project over to a
-- different manager (the edit form allows changing the manager).
CREATE POLICY "Managers and super admins can update projects"
  ON public.projects FOR UPDATE
  USING (
    project_manager_id = public.app_user_id()
    OR public.has_role(public.app_user_id(), 'super_admin'::app_role)
  )
  WITH CHECK (public.app_user_id() IS NOT NULL);

CREATE POLICY "Super admins can delete projects"
  ON public.projects FOR DELETE
  USING (public.has_role(public.app_user_id(), 'super_admin'::app_role));

-- ------------------------------------------------------------
-- project_tasks
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to project_tasks" ON public.project_tasks;

CREATE POLICY "Project members can view tasks"
  ON public.project_tasks FOR SELECT
  USING (public.can_access_project(project_id));

CREATE POLICY "Project members can create tasks"
  ON public.project_tasks FOR INSERT
  WITH CHECK (public.can_access_project(project_id));

CREATE POLICY "Project members can update tasks"
  ON public.project_tasks FOR UPDATE
  USING (public.can_access_project(project_id))
  WITH CHECK (public.can_access_project(project_id));

CREATE POLICY "Super admins can delete tasks"
  ON public.project_tasks FOR DELETE
  USING (public.has_role(public.app_user_id(), 'super_admin'::app_role));

-- ------------------------------------------------------------
-- project_documents
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to project_documents" ON public.project_documents;

CREATE POLICY "Project members can view documents"
  ON public.project_documents FOR SELECT
  USING (public.can_access_project(project_id));

CREATE POLICY "Project members can add documents"
  ON public.project_documents FOR INSERT
  WITH CHECK (
    public.can_access_project(project_id)
    AND (uploaded_by IS NULL OR uploaded_by = public.app_user_id())
  );

CREATE POLICY "Project members can delete documents"
  ON public.project_documents FOR DELETE
  USING (public.can_access_project(project_id));

-- ------------------------------------------------------------
-- Project numbering must see ALL projects, not the RLS-filtered set,
-- or two managers could be handed the same PRJ number. Recreate the
-- trigger function as SECURITY DEFINER.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_project_number()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ------------------------------------------------------------
-- Storage: private bucket + bucket-scoped policies.
-- The storage API does not forward request headers into Postgres, so
-- per-user rules cannot be expressed here; scoping to the bucket and
-- keeping it private (expiring signed URLs, no permanent public URLs)
-- is the strongest guarantee available under the current auth model.
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-documents', 'project-documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Allow public read project-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated upload project-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated delete project-documents" ON storage.objects;

CREATE POLICY "project_documents_storage_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'project-documents');
CREATE POLICY "project_documents_storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'project-documents');
CREATE POLICY "project_documents_storage_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'project-documents');
