
-- Drop existing restrictive policies and recreate with permissive access for anon role
DROP POLICY IF EXISTS "Authenticated users can view asset reconciliations" ON public.asset_reconciliations;
DROP POLICY IF EXISTS "Authenticated users can create asset reconciliations" ON public.asset_reconciliations;
DROP POLICY IF EXISTS "Authenticated users can update asset reconciliations" ON public.asset_reconciliations;
DROP POLICY IF EXISTS "Authenticated users can delete asset reconciliations" ON public.asset_reconciliations;

DROP POLICY IF EXISTS "Authenticated users can view reconciliation items" ON public.asset_reconciliation_items;
DROP POLICY IF EXISTS "Authenticated users can create reconciliation items" ON public.asset_reconciliation_items;
DROP POLICY IF EXISTS "Authenticated users can update reconciliation items" ON public.asset_reconciliation_items;
DROP POLICY IF EXISTS "Authenticated users can delete reconciliation items" ON public.asset_reconciliation_items;

-- Permissive policies for asset_reconciliations
CREATE POLICY "Allow all select on asset_reconciliations" ON public.asset_reconciliations FOR SELECT USING (true);
CREATE POLICY "Allow all insert on asset_reconciliations" ON public.asset_reconciliations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on asset_reconciliations" ON public.asset_reconciliations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on asset_reconciliations" ON public.asset_reconciliations FOR DELETE USING (true);

-- Permissive policies for asset_reconciliation_items
CREATE POLICY "Allow all select on asset_reconciliation_items" ON public.asset_reconciliation_items FOR SELECT USING (true);
CREATE POLICY "Allow all insert on asset_reconciliation_items" ON public.asset_reconciliation_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on asset_reconciliation_items" ON public.asset_reconciliation_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Allow all delete on asset_reconciliation_items" ON public.asset_reconciliation_items FOR DELETE USING (true);
