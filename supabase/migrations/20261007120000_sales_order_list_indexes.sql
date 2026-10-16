-- Sales order list performance: index the foreign key the order list and the
-- per-line totals trigger look up by (sales_order_items.order_id had no index),
-- and let the windowed list seek straight to a segment's recent orders.
CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_id
  ON public.sales_order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_sales_orders_segment_order_date
  ON public.sales_orders(sales_segment, order_date DESC);
