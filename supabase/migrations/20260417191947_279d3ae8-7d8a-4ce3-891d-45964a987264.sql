-- Backfill sales_orders.status for orders whose dispatched qty already covers ordered qty
-- but whose status was never updated (e.g. dispatched before trigger existed, or trigger
-- was temporarily detached). The triggers themselves are already in place.

WITH totals AS (
  SELECT
    soi.order_id,
    SUM(soi.quantity_dozens)     AS total_qty,
    SUM(soi.quantity_dispatched) AS total_dispatched
  FROM public.sales_order_items soi
  GROUP BY soi.order_id
)
UPDATE public.sales_orders so
SET status = CASE
  WHEN t.total_dispatched >= t.total_qty AND t.total_qty > 0 THEN 'dispatched'
  WHEN t.total_dispatched > 0 THEN 'partially_dispatched'
  ELSE so.status
END,
updated_at = now()
FROM totals t
WHERE so.id = t.order_id
  AND so.status NOT IN ('cancelled', 'completed', 'dispatched')
  AND t.total_dispatched > 0
  AND (
    (t.total_dispatched >= t.total_qty AND t.total_qty > 0 AND so.status <> 'dispatched')
    OR (t.total_dispatched < t.total_qty AND so.status NOT IN ('partially_dispatched','dispatched'))
  );