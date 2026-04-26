
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
  -- Get the order_id from the affected order item
  SELECT order_id INTO v_order_id
  FROM public.sales_order_items
  WHERE id = COALESCE(NEW.order_item_id, OLD.order_item_id);

  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Calculate total ordered vs dispatched for this order
  SELECT 
    COALESCE(SUM(quantity_dozens), 0),
    COALESCE(SUM(quantity_dispatched), 0)
  INTO v_total_qty, v_total_dispatched
  FROM public.sales_order_items
  WHERE order_id = v_order_id;

  -- Determine new status
  IF v_total_dispatched >= v_total_qty AND v_total_qty > 0 THEN
    v_new_status := 'dispatched';
  ELSIF v_total_dispatched > 0 THEN
    v_new_status := 'partially_dispatched';
  ELSE
    -- Don't change status if nothing dispatched
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Update order status (only if not already cancelled/completed)
  UPDATE public.sales_orders
  SET status = v_new_status, updated_at = now()
  WHERE id = v_order_id
    AND status NOT IN ('cancelled', 'completed');

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_update_order_status_on_dispatch
AFTER INSERT OR UPDATE OR DELETE ON public.sales_dispatch_items
FOR EACH ROW
EXECUTE FUNCTION public.update_sales_order_status_on_dispatch();
