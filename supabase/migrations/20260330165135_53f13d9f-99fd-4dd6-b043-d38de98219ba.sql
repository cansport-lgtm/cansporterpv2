
DROP POLICY IF EXISTS "Authenticated users can delete online orders" ON public.online_orders;
DROP POLICY IF EXISTS "Authenticated users can insert online orders" ON public.online_orders;
DROP POLICY IF EXISTS "Authenticated users can update online orders" ON public.online_orders;
DROP POLICY IF EXISTS "Authenticated users can view online orders" ON public.online_orders;

CREATE POLICY "Allow anon select" ON public.online_orders FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.online_orders FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.online_orders FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete" ON public.online_orders FOR DELETE TO anon USING (true);
