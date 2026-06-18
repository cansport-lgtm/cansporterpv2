-- Add a master "standard selling price" to products / SKUs.
-- Used as the default price_per_dozen on sales orders & quotations when no
-- customer-specific price (customer_pricing) applies, so lines are never saved
-- at Rs. 0 — which previously produced dispatches where COGS posted but no
-- sales revenue / AR voucher was created (e.g. dispatches DC-00053 / DC-00054).
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS standard_selling_price numeric DEFAULT 0;

COMMENT ON COLUMN public.products.standard_selling_price IS
  'Default selling price per dozen. Auto-fills sales order / quotation lines when no customer_pricing entry applies. Customer-specific pricing takes precedence.';
