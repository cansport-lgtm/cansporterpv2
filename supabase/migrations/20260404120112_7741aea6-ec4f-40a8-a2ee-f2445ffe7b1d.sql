DROP POLICY IF EXISTS "Allow authenticated access to hr_advances" ON public.hr_advances;

CREATE POLICY "Allow anon access to hr_advances"
ON public.hr_advances
FOR ALL
TO anon
USING (true)
WITH CHECK (true);