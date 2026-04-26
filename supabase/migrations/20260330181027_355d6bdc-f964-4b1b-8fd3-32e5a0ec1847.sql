
CREATE POLICY "Allow all select on online_load_sheets" ON public.online_load_sheets FOR SELECT USING (true);
CREATE POLICY "Allow all insert on online_load_sheets" ON public.online_load_sheets FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on online_load_sheets" ON public.online_load_sheets FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on online_load_sheets" ON public.online_load_sheets FOR DELETE USING (true);
