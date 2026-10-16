-- Rollback for 20261012120000_sales_order_dispatch_status.sql
-- Restores the two-trigger arrangement from 20260112200932 and 20260403035012
-- (including its firing-order fault). Statuses already corrected by the
-- backfill are left as they are.

DROP TRIGGER IF EXISTS trg_sales_order_items_recalc_status ON public.sales_order_items;
DROP FUNCTION IF EXISTS public.sales_order_items_recalc_status();
DROP FUNCTION IF EXISTS public.sales_order_recalc_status(uuid);

CREATE OR REPLACE FUNCTION public.update_order_item_dispatched_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched + NEW.quantity_dozens
    WHERE id = NEW.order_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched - OLD.quantity_dozens
    WHERE id = OLD.order_item_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched - OLD.quantity_dozens + NEW.quantity_dozens
    WHERE id = NEW.order_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_sales_order_status_on_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_total_qty numeric;
  v_total_dispatched numeric;
  v_new_status text;
BEGIN
  SELECT order_id INTO v_order_id
  FROM public.sales_order_items
  WHERE id = COALESCE(NEW.order_item_id, OLD.order_item_id);

  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT
    COALESCE(SUM(quantity_dozens), 0),
    COALESCE(SUM(quantity_dispatched), 0)
  INTO v_total_qty, v_total_dispatched
  FROM public.sales_order_items
  WHERE order_id = v_order_id;

  IF v_total_dispatched >= v_total_qty AND v_total_qty > 0 THEN
    v_new_status := 'dispatched';
  ELSIF v_total_dispatched > 0 THEN
    v_new_status := 'partially_dispatched';
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.sales_orders
  SET status = v_new_status, updated_at = now()
  WHERE id = v_order_id
    AND status NOT IN ('cancelled', 'completed');

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE TRIGGER trg_update_order_status_on_dispatch
AFTER INSERT OR UPDATE OR DELETE ON public.sales_dispatch_items
FOR EACH ROW
EXECUTE FUNCTION public.update_sales_order_status_on_dispatch();
