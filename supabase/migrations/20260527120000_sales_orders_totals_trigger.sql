-- Keep sales_orders.total_amount / net_amount in sync with sales_order_items.
-- Order create flow inserts header with totals = 0 and never updates them, so
-- order list views and any report keyed off these columns show $0. The trigger
-- below recalculates them whenever items change, and a one-time backfill
-- corrects existing rows.

CREATE OR REPLACE FUNCTION public.recalc_sales_order_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id UUID;
  v_total DECIMAL(14, 2);
  v_discount_percent DECIMAL(5, 2);
BEGIN
  v_order_id := COALESCE(NEW.order_id, OLD.order_id);

  SELECT COALESCE(SUM(amount), 0)
    INTO v_total
    FROM public.sales_order_items
    WHERE order_id = v_order_id;

  SELECT COALESCE(discount_percent, 0)
    INTO v_discount_percent
    FROM public.sales_orders
    WHERE id = v_order_id;

  UPDATE public.sales_orders
    SET total_amount = v_total,
        net_amount   = ROUND(v_total - (v_total * v_discount_percent / 100), 2),
        updated_at   = now()
    WHERE id = v_order_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_sales_order_totals ON public.sales_order_items;

CREATE TRIGGER trg_recalc_sales_order_totals
AFTER INSERT OR UPDATE OF quantity_dozens, price_per_dozen, amount, order_id
            OR DELETE
ON public.sales_order_items
FOR EACH ROW
EXECUTE FUNCTION public.recalc_sales_order_totals();

-- Also recalc net_amount when the order-level discount_percent changes.
CREATE OR REPLACE FUNCTION public.recalc_sales_order_net_on_discount()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
    NEW.net_amount := ROUND(
      COALESCE(NEW.total_amount, 0)
        - (COALESCE(NEW.total_amount, 0) * COALESCE(NEW.discount_percent, 0) / 100),
      2
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_sales_order_net_on_discount ON public.sales_orders;

CREATE TRIGGER trg_recalc_sales_order_net_on_discount
BEFORE UPDATE OF discount_percent ON public.sales_orders
FOR EACH ROW
EXECUTE FUNCTION public.recalc_sales_order_net_on_discount();

-- Backfill existing rows.
UPDATE public.sales_orders o
SET total_amount = sub.total,
    net_amount   = ROUND(sub.total - (sub.total * COALESCE(o.discount_percent, 0) / 100), 2),
    updated_at   = now()
FROM (
  SELECT order_id, COALESCE(SUM(amount), 0) AS total
  FROM public.sales_order_items
  GROUP BY order_id
) sub
WHERE o.id = sub.order_id
  AND (o.total_amount IS DISTINCT FROM sub.total
       OR o.net_amount IS DISTINCT FROM ROUND(sub.total - (sub.total * COALESCE(o.discount_percent, 0) / 100), 2));
