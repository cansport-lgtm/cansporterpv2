
-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Authenticated users can view 5S departments" ON public.five_s_departments;
DROP POLICY IF EXISTS "Authenticated users can insert 5S departments" ON public.five_s_departments;
DROP POLICY IF EXISTS "Authenticated users can update 5S departments" ON public.five_s_departments;
DROP POLICY IF EXISTS "Authenticated users can delete 5S departments" ON public.five_s_departments;

-- Create open policies since app uses custom auth (app_users table), not Supabase Auth
CREATE POLICY "Allow select on five_s_departments" ON public.five_s_departments FOR SELECT USING (true);
CREATE POLICY "Allow insert on five_s_departments" ON public.five_s_departments FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update on five_s_departments" ON public.five_s_departments FOR UPDATE USING (true);
CREATE POLICY "Allow delete on five_s_departments" ON public.five_s_departments FOR DELETE USING (true);
