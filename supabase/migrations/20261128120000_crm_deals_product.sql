-- Link each CRM deal to one product (optional) so the Deals Pipeline can
-- show and filter by product.
ALTER TABLE public.crm_deals
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_crm_deals_product_id ON public.crm_deals(product_id);
