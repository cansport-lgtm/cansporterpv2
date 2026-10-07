-- Rollback for 20261015120100_qa_super_manager_rls.sql
-- Restores the open "Full access" policies on the Daily Quality Plan tables.
-- (The 'qa_super_manager' enum value itself can't be dropped from app_role.)

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['qa_plan_templates', 'qa_plan_template_items', 'qa_daily_plans', 'qa_daily_plan_items']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Anyone can view %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Target setters can insert %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Target setters can update %1$s" ON public.%1$I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can delete %1$s" ON public.%1$I', t);
    EXECUTE format('CREATE POLICY "Full access for %1$s" ON public.%1$I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.can_set_qa_daily_targets();
DROP FUNCTION IF EXISTS public.can_delete_qa_daily_targets();
