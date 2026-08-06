-- Sibling tables (online_orders, online_dispatches) allow anon read/write
-- because the app uses a custom auth layer rather than Supabase Auth.
-- online_returns was missed, causing "new row violates row-level security
-- policy" errors when the Quick Receive flow tried to insert from the client.

CREATE POLICY "Allow anon select" ON public.online_returns FOR SELECT TO anon USING (true);
CREATE POLICY "Allow anon insert" ON public.online_returns FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Allow anon update" ON public.online_returns FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon delete" ON public.online_returns FOR DELETE TO anon USING (true);
