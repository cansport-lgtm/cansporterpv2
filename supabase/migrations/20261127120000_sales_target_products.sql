-- ============================================================
-- Products tracked on the Sales Targets page (one shared list).
-- Only products listed here appear on the page and can be given a
-- target. Deselecting a product just removes it from this list; its
-- saved targets in sales_product_targets are kept.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sales_target_products (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  added_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.sales_target_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_target_products_all" ON public.sales_target_products;
CREATE POLICY "sales_target_products_all" ON public.sales_target_products FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_target_products TO anon, authenticated, service_role;

-- Keep every product that already has a target tracked, so nothing
-- disappears from the page when this ships.
INSERT INTO public.sales_target_products (product_id)
SELECT DISTINCT product_id FROM public.sales_product_targets
ON CONFLICT (product_id) DO NOTHING;
