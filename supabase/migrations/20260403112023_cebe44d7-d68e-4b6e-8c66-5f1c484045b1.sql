
CREATE POLICY "Allow anon full access to public_holidays" ON public.public_holidays
FOR ALL TO anon
USING (true)
WITH CHECK (true);
