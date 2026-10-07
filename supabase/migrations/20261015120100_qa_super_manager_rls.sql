-- ============================================================
-- Daily Quality Plan — only the QA Super Manager (and admins)
-- set daily targets
--
-- The plan / template tables were open to everyone ("Full access"
-- policies). Now:
--   * anyone can still read plans and templates (QA dashboard,
--     progress tracking)
--   * only super_admin / admin / qa_super_manager can create or
--     update plans, plan items, templates and template items
--   * only super_admin / admin can delete them
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_set_qa_daily_targets()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(public.app_user_id(), 'super_admin'::app_role)
      OR public.has_role(public.app_user_id(), 'admin'::app_role)
      OR public.has_role(public.app_user_id(), 'qa_super_manager'::app_role)
$$;

CREATE OR REPLACE FUNCTION public.can_delete_qa_daily_targets()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(public.app_user_id(), 'super_admin'::app_role)
      OR public.has_role(public.app_user_id(), 'admin'::app_role)
$$;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['qa_plan_templates', 'qa_plan_template_items', 'qa_daily_plans', 'qa_daily_plan_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Full access for %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Anyone can view %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Target setters can insert %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Target setters can update %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can delete %1$s" ON public.%1$I', t);

    EXECUTE format('CREATE POLICY "Anyone can view %1$s" ON public.%1$I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "Target setters can insert %1$s" ON public.%1$I FOR INSERT WITH CHECK (public.can_set_qa_daily_targets())', t);
    EXECUTE format('CREATE POLICY "Target setters can update %1$s" ON public.%1$I FOR UPDATE USING (public.can_set_qa_daily_targets()) WITH CHECK (public.can_set_qa_daily_targets())', t);
    EXECUTE format('CREATE POLICY "Admins can delete %1$s" ON public.%1$I FOR DELETE USING (public.can_delete_qa_daily_targets())', t);
  END LOOP;
END $$;
