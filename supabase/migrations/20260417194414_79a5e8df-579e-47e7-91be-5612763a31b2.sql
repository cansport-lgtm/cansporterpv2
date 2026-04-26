DROP POLICY IF EXISTS "Authenticated users can view six sigma projects" ON public.six_sigma_projects;
DROP POLICY IF EXISTS "Authenticated users can insert six sigma projects" ON public.six_sigma_projects;
DROP POLICY IF EXISTS "Authenticated users can update six sigma projects" ON public.six_sigma_projects;
DROP POLICY IF EXISTS "Authenticated users can delete six sigma projects" ON public.six_sigma_projects;

CREATE POLICY "Allow all access to six_sigma_projects"
  ON public.six_sigma_projects FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);