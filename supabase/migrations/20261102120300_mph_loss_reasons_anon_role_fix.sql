-- ============================================================================
-- MPH Loss Reasons: the app uses its own login (app_users) and reaches
-- Supabase as the anon role, so the super-admin write policies and the
-- function grants from 20261102120100 must cover anon as well. Without this a
-- super admin's edit on the reason master matched no rows (saved nothing,
-- no error) and the Save / Submit / Reopen calls were refused.
-- ============================================================================

ALTER POLICY "Super admin writes mph_loss_reasons" ON public.mph_loss_reasons TO anon, authenticated;
ALTER POLICY "Super admin writes mph_loss_reason_departments" ON public.mph_loss_reason_departments TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mph_loss_reasons, public.mph_loss_reason_departments TO anon;
GRANT USAGE, SELECT ON SEQUENCE public.mph_loss_reason_code_seq TO anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_reopen(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_can_edit() TO anon;
