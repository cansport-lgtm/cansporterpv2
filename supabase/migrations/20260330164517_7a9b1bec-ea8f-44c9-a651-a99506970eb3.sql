
DROP POLICY IF EXISTS "Allow authenticated read" ON public.online_platforms;
DROP POLICY IF EXISTS "Allow authenticated insert" ON public.online_platforms;
DROP POLICY IF EXISTS "Allow authenticated update" ON public.online_platforms;
DROP POLICY IF EXISTS "Allow authenticated delete" ON public.online_platforms;

CREATE POLICY "Allow anon read" ON public.online_platforms FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.online_platforms FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.online_platforms FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete" ON public.online_platforms FOR DELETE TO anon USING (true);
