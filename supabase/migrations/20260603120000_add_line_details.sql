-- Per-product-line customer-facing "Details" text, flows order -> invoice -> print.
ALTER TABLE public.sales_order_items      ADD COLUMN IF NOT EXISTS details text;
ALTER TABLE public.domestic_invoice_items ADD COLUMN IF NOT EXISTS details text;
