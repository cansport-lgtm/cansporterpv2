-- COGS feature: standard costs (cost master) + per-dispatch-line COGS snapshot

-- 1. standard_costs: cost-per-dozen per (product, grade)
CREATE TABLE IF NOT EXISTS public.standard_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  grade_id UUID REFERENCES public.grades(id) ON DELETE SET NULL,
  cost_per_dozen NUMERIC NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by UUID REFERENCES public.app_users(id),
  updated_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- nullable grade_id: two NULLs are distinct in Postgres, so dedupe via COALESCE expression index
CREATE UNIQUE INDEX IF NOT EXISTS standard_costs_product_grade_uniq
  ON public.standard_costs (product_id, COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS standard_costs_product_idx ON public.standard_costs (product_id);

DROP TRIGGER IF EXISTS trg_standard_costs_updated_at ON public.standard_costs;
CREATE TRIGGER trg_standard_costs_updated_at
  BEFORE UPDATE ON public.standard_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. dispatch_item_cogs: per-line snapshot of cost at posting time
CREATE TABLE IF NOT EXISTS public.dispatch_item_cogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id UUID NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE CASCADE,
  dispatch_item_id UUID NOT NULL REFERENCES public.sales_dispatch_items(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  grade_id UUID REFERENCES public.grades(id) ON DELETE SET NULL,
  quantity_dozens NUMERIC NOT NULL DEFAULT 0,
  cost_per_dozen_snapshot NUMERIC NOT NULL DEFAULT 0,
  cogs_amount NUMERIC NOT NULL DEFAULT 0,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  posted_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dispatch_item_cogs_item_uniq ON public.dispatch_item_cogs (dispatch_item_id);
CREATE INDEX IF NOT EXISTS dispatch_item_cogs_dispatch_idx ON public.dispatch_item_cogs (dispatch_id);
CREATE INDEX IF NOT EXISTS dispatch_item_cogs_product_idx ON public.dispatch_item_cogs (product_id);

-- 3. RLS: this app uses custom (app-layer) auth, so the Supabase client connects as anon/public.
--    Match the app's existing convention (every table uses a single permissive "Allow all TO public"
--    policy and relies on app-layer permission checks). Stricter TO authenticated policies would block
--    the anon client and break the feature.
ALTER TABLE public.standard_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_item_cogs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for standard_costs"     ON public.standard_costs     FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for dispatch_item_cogs" ON public.dispatch_item_cogs FOR ALL TO public USING (true) WITH CHECK (true);

-- 4. upsert_standard_cost: COALESCE-aware update-else-insert (nullable grade)
CREATE OR REPLACE FUNCTION public.upsert_standard_cost(
  p_product UUID,
  p_grade UUID,
  p_cost NUMERIC,
  p_user UUID DEFAULT NULL
) RETURNS void LANGUAGE plpgsql
SET search_path = public AS $$
BEGIN
  UPDATE public.standard_costs
     SET cost_per_dozen = p_cost,
         is_active = true,
         updated_by = p_user,
         updated_at = now()
   WHERE product_id = p_product
     AND COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_grade, '00000000-0000-0000-0000-000000000000'::uuid);
  IF NOT FOUND THEN
    INSERT INTO public.standard_costs (product_id, grade_id, cost_per_dozen, created_by, updated_by)
    VALUES (p_product, p_grade, p_cost, p_user, p_user);
  END IF;
END; $$;

-- 5. recompute_dispatch_cogs: snapshot/refresh COGS lines for a dispatch from CURRENT standard costs
CREATE OR REPLACE FUNCTION public.recompute_dispatch_cogs(
  p_dispatch_id UUID,
  p_user UUID DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
BEGIN
  -- drop snapshot rows whose dispatch line no longer exists
  DELETE FROM public.dispatch_item_cogs
   WHERE dispatch_id = p_dispatch_id
     AND dispatch_item_id NOT IN (
       SELECT id FROM public.sales_dispatch_items WHERE dispatch_id = p_dispatch_id
     );

  INSERT INTO public.dispatch_item_cogs
    (dispatch_id, dispatch_item_id, product_id, grade_id,
     quantity_dozens, cost_per_dozen_snapshot, cogs_amount, posted_at, posted_by)
  SELECT di.dispatch_id,
         di.id,
         oi.product_id,
         oi.grade_id,
         di.quantity_dozens,
         COALESCE(sc.cost_per_dozen, 0),
         di.quantity_dozens * COALESCE(sc.cost_per_dozen, 0),
         now(),
         p_user
  FROM public.sales_dispatch_items di
  JOIN public.sales_order_items oi ON oi.id = di.order_item_id
  LEFT JOIN public.standard_costs sc
    ON sc.product_id = oi.product_id
   AND COALESCE(sc.grade_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(oi.grade_id, '00000000-0000-0000-0000-000000000000'::uuid)
   AND sc.is_active = true
  WHERE di.dispatch_id = p_dispatch_id
  ON CONFLICT (dispatch_item_id) DO UPDATE
     SET product_id = EXCLUDED.product_id,
         grade_id = EXCLUDED.grade_id,
         quantity_dozens = EXCLUDED.quantity_dozens,
         cost_per_dozen_snapshot = EXCLUDED.cost_per_dozen_snapshot,
         cogs_amount = EXCLUDED.cogs_amount,
         posted_at = EXCLUDED.posted_at,
         posted_by = EXCLUDED.posted_by;
END; $$;

-- App connects as anon (custom app-layer auth), so both functions must be executable by anon.
GRANT EXECUTE ON FUNCTION public.recompute_dispatch_cogs(UUID, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_standard_cost(UUID, UUID, NUMERIC, UUID) TO anon, authenticated;
