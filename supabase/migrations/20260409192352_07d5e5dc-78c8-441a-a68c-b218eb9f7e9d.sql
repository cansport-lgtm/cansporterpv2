
DROP POLICY IF EXISTS "Full access for authenticated" ON public.mph_calculating_numbers;

CREATE POLICY "Allow full access for anon" ON public.mph_calculating_numbers FOR ALL TO anon USING (true) WITH CHECK (true);
