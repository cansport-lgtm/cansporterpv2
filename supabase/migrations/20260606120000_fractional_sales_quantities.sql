-- Allow fractional (less than 1) quantities on sales orders, dispatches and
-- quotations. These columns were originally INTEGER, which silently blocked /
-- rounded decimal quantities such as 0.5 dozens. Widen them to NUMERIC(12, 2)
-- to match the rest of the schema (sales_quotation/return/invoice items in
-- later migrations already use NUMERIC(12, 2)).

-- The recalc trigger is bound to quantity_dozens via its UPDATE OF clause, so
-- Postgres won't let us alter the column type while it exists. Drop it, change
-- the types, then recreate it with the identical definition.
DROP TRIGGER IF EXISTS trg_recalc_sales_order_totals ON public.sales_order_items;

ALTER TABLE public.sales_order_items
  ALTER COLUMN quantity_dozens TYPE NUMERIC(12, 2),
  ALTER COLUMN quantity_dispatched TYPE NUMERIC(12, 2);

ALTER TABLE public.sales_dispatch_items
  ALTER COLUMN quantity_dozens TYPE NUMERIC(12, 2);

ALTER TABLE public.sales_quotation_items
  ALTER COLUMN quantity_dozens TYPE NUMERIC(12, 2);

CREATE TRIGGER trg_recalc_sales_order_totals
  AFTER INSERT OR DELETE OR UPDATE OF quantity_dozens, price_per_dozen, amount, order_id
  ON public.sales_order_items
  FOR EACH ROW EXECUTE FUNCTION recalc_sales_order_totals();
