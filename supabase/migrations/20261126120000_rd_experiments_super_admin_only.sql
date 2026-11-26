-- R&D experiments: visible/editable by super_admin only.
-- Acting user is resolved via app_user_id() (x-app-user-id header), same as
-- the project management RLS migration.
DROP POLICY IF EXISTS "Allow all access to rd_experiments" ON public.rd_experiments;

CREATE POLICY "rd_experiments super_admin only" ON public.rd_experiments
  FOR ALL
  USING (public.has_role(public.app_user_id(), 'super_admin'::app_role))
  WITH CHECK (public.has_role(public.app_user_id(), 'super_admin'::app_role));
