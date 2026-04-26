-- Drop existing restrictive RLS policies on consumption tables
DROP POLICY IF EXISTS "Users with material_consumption permission can view" ON public.consumption_raw_materials;
DROP POLICY IF EXISTS "Users with material_consumption permission can insert" ON public.consumption_raw_materials;
DROP POLICY IF EXISTS "Users with material_consumption permission can update" ON public.consumption_raw_materials;
DROP POLICY IF EXISTS "Users with material_consumption permission can delete" ON public.consumption_raw_materials;

DROP POLICY IF EXISTS "Users with material_consumption permission can view" ON public.consumption_bom;
DROP POLICY IF EXISTS "Users with material_consumption permission can insert" ON public.consumption_bom;
DROP POLICY IF EXISTS "Users with material_consumption permission can update" ON public.consumption_bom;
DROP POLICY IF EXISTS "Users with material_consumption permission can delete" ON public.consumption_bom;

DROP POLICY IF EXISTS "Users with material_consumption permission can view" ON public.consumption_stock_closing;
DROP POLICY IF EXISTS "Users with material_consumption permission can insert" ON public.consumption_stock_closing;
DROP POLICY IF EXISTS "Users with material_consumption permission can update" ON public.consumption_stock_closing;
DROP POLICY IF EXISTS "Users with material_consumption permission can delete" ON public.consumption_stock_closing;

DROP POLICY IF EXISTS "Users with material_consumption permission can view" ON public.consumption_production_entry;
DROP POLICY IF EXISTS "Users with material_consumption permission can insert" ON public.consumption_production_entry;
DROP POLICY IF EXISTS "Users with material_consumption permission can update" ON public.consumption_production_entry;
DROP POLICY IF EXISTS "Users with material_consumption permission can delete" ON public.consumption_production_entry;

-- Create permissive policies for consumption_raw_materials (app uses custom auth)
CREATE POLICY "Allow all select on consumption_raw_materials" ON public.consumption_raw_materials FOR SELECT USING (true);
CREATE POLICY "Allow all insert on consumption_raw_materials" ON public.consumption_raw_materials FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on consumption_raw_materials" ON public.consumption_raw_materials FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on consumption_raw_materials" ON public.consumption_raw_materials FOR DELETE USING (true);

-- Create permissive policies for consumption_bom
CREATE POLICY "Allow all select on consumption_bom" ON public.consumption_bom FOR SELECT USING (true);
CREATE POLICY "Allow all insert on consumption_bom" ON public.consumption_bom FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on consumption_bom" ON public.consumption_bom FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on consumption_bom" ON public.consumption_bom FOR DELETE USING (true);

-- Create permissive policies for consumption_stock_closing
CREATE POLICY "Allow all select on consumption_stock_closing" ON public.consumption_stock_closing FOR SELECT USING (true);
CREATE POLICY "Allow all insert on consumption_stock_closing" ON public.consumption_stock_closing FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on consumption_stock_closing" ON public.consumption_stock_closing FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on consumption_stock_closing" ON public.consumption_stock_closing FOR DELETE USING (true);

-- Create permissive policies for consumption_production_entry
CREATE POLICY "Allow all select on consumption_production_entry" ON public.consumption_production_entry FOR SELECT USING (true);
CREATE POLICY "Allow all insert on consumption_production_entry" ON public.consumption_production_entry FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on consumption_production_entry" ON public.consumption_production_entry FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on consumption_production_entry" ON public.consumption_production_entry FOR DELETE USING (true);