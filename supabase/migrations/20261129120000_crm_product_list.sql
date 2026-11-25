-- Curated list of ERP products used in CRM (deal product dropdown and pipeline filter).
-- When the list is empty the app falls back to all active products.
CREATE TABLE IF NOT EXISTS public.crm_product_list (
  product_id uuid PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_product_list ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read" ON public.crm_product_list;
CREATE POLICY "Public read" ON public.crm_product_list FOR SELECT USING (true);

DROP POLICY IF EXISTS "Full access" ON public.crm_product_list;
CREATE POLICY "Full access" ON public.crm_product_list FOR ALL USING (true) WITH CHECK (true);
