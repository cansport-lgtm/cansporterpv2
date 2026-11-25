-- Products selectable on the CRM Deals Pipeline (one shared list, picked
-- from the product master). Deselecting a product only removes it from the
-- dropdown/filter; deals already linked to it keep their product.
CREATE TABLE IF NOT EXISTS public.crm_deal_products (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  added_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.crm_deal_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crm_deal_products_all" ON public.crm_deal_products;
CREATE POLICY "crm_deal_products_all" ON public.crm_deal_products FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.crm_deal_products TO anon, authenticated, service_role;

-- Keep products already used on deals selectable.
INSERT INTO public.crm_deal_products (product_id)
SELECT DISTINCT product_id FROM public.crm_deals WHERE product_id IS NOT NULL
ON CONFLICT (product_id) DO NOTHING;
