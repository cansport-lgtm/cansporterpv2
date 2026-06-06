-- Allow fractional (less than 1) quantities on sales orders, dispatches and
-- quotations. These columns were originally INTEGER, which silently blocked /
-- rounded decimal quantities such as 0.5 dozens. Widen them to NUMERIC(12, 2)
-- to match the rest of the schema (sales_quotation/return/invoice items in
-- later migrations already use NUMERIC(12, 2)).

ALTER TABLE public.sales_order_items
  ALTER COLUMN quantity_dozens TYPE NUMERIC(12, 2),
  ALTER COLUMN quantity_dispatched TYPE NUMERIC(12, 2);

ALTER TABLE public.sales_dispatch_items
  ALTER COLUMN quantity_dozens TYPE NUMERIC(12, 2);

ALTER TABLE public.sales_quotation_items
  ALTER COLUMN quantity_dozens TYPE NUMERIC(12, 2);
