
CREATE POLICY "Allow all select on online_dispatches" ON public.online_dispatches FOR SELECT USING (true);
CREATE POLICY "Allow all insert on online_dispatches" ON public.online_dispatches FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on online_dispatches" ON public.online_dispatches FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on online_dispatches" ON public.online_dispatches FOR DELETE USING (true);
