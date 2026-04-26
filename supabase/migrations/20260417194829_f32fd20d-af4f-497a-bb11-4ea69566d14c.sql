-- six_sigma_tools
DROP POLICY IF EXISTS "Authenticated users can view six sigma tools" ON public.six_sigma_tools;
DROP POLICY IF EXISTS "Authenticated users can insert six sigma tools" ON public.six_sigma_tools;
DROP POLICY IF EXISTS "Authenticated users can update six sigma tools" ON public.six_sigma_tools;
DROP POLICY IF EXISTS "Authenticated users can delete six sigma tools" ON public.six_sigma_tools;
CREATE POLICY "Allow all access to six_sigma_tools" ON public.six_sigma_tools FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- six_sigma_metrics
DROP POLICY IF EXISTS "Authenticated users can view six sigma metrics" ON public.six_sigma_metrics;
DROP POLICY IF EXISTS "Authenticated users can insert six sigma metrics" ON public.six_sigma_metrics;
DROP POLICY IF EXISTS "Authenticated users can update six sigma metrics" ON public.six_sigma_metrics;
DROP POLICY IF EXISTS "Authenticated users can delete six sigma metrics" ON public.six_sigma_metrics;
CREATE POLICY "Allow all access to six_sigma_metrics" ON public.six_sigma_metrics FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- six_sigma_phases
DROP POLICY IF EXISTS "Authenticated users can view six sigma phases" ON public.six_sigma_phases;
DROP POLICY IF EXISTS "Authenticated users can insert six sigma phases" ON public.six_sigma_phases;
DROP POLICY IF EXISTS "Authenticated users can update six sigma phases" ON public.six_sigma_phases;
DROP POLICY IF EXISTS "Authenticated users can delete six sigma phases" ON public.six_sigma_phases;
CREATE POLICY "Allow all access to six_sigma_phases" ON public.six_sigma_phases FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

-- six_sigma_team_members
DROP POLICY IF EXISTS "Authenticated users can view six sigma team" ON public.six_sigma_team_members;
DROP POLICY IF EXISTS "Authenticated users can insert six sigma team" ON public.six_sigma_team_members;
DROP POLICY IF EXISTS "Authenticated users can update six sigma team" ON public.six_sigma_team_members;
DROP POLICY IF EXISTS "Authenticated users can delete six sigma team" ON public.six_sigma_team_members;
CREATE POLICY "Allow all access to six_sigma_team_members" ON public.six_sigma_team_members FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);