-- ============================================================================
-- Sales order status follows its dispatches
-- ----------------------------------------------------------------------------
-- Two AFTER ROW triggers on sales_dispatch_items shared this job: one added
-- the line's dozens to sales_order_items.quantity_dispatched, the other summed
-- those totals and set the order to dispatched / partially_dispatched.
-- Postgres fires same-event triggers in name order, and
-- trg_update_order_status_on_dispatch sorts before update_dispatched_qty, so
-- the status was always computed from totals one line behind: an order's
-- first dispatch left it Confirmed, and a full dispatch in one go ended as
-- Partially Dispatched. 49 open domestic orders carried a wrong status when
-- this was written.
--
-- Now:
--   * sales_order_recalc_status(order_id) is the single rule:
--       dispatched            dispatched >= ordered (and ordered > 0)
--       partially_dispatched  0 < dispatched < ordered
--       confirmed             dispatched is back to 0 on an order that was
--                             dispatched / partially_dispatched (a dispatch
--                             was deleted or its lines were taken off)
--     Any other case leaves the status alone. Cancelled, completed and
--     delivered orders are never touched, and the row is only written when
--     the status actually changes.
--   * The quantity trigger on sales_dispatch_items keeps its job (now
--     NULL-safe) and no longer competes with a second trigger.
--   * A trigger on sales_order_items recalculates when a line's ordered or
--     dispatched quantity changes, or a line is added or removed, so editing
--     an order after dispatch corrects its status too. The dispatch-line
--     trigger's own UPDATE of quantity_dispatched fires it, which is what puts
--     the status write after the quantity write.
--   * A one-time backfill runs the rule over every open order.
--
-- The order pages no longer offer Dispatched / Partially Dispatched in the
-- manual status dropdown; the database owns those two.
-- Rollback: supabase/rollbacks/20261012120000_sales_order_dispatch_status_down.sql
-- ============================================================================

-- 1. The rule ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.sales_order_recalc_status(p_order_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status           text;
  v_total_qty        numeric;
  v_total_dispatched numeric;
  v_new_status       text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN;
  END IF;

  -- Lock the order so two dispatches saved at once cannot race each other.
  SELECT status INTO v_status
    FROM public.sales_orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF v_status IS NULL OR v_status IN ('cancelled', 'completed', 'delivered') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(quantity_dozens), 0),
         COALESCE(SUM(COALESCE(quantity_dispatched, 0)), 0)
    INTO v_total_qty, v_total_dispatched
    FROM public.sales_order_items
   WHERE order_id = p_order_id;

  IF v_total_qty > 0 AND v_total_dispatched >= v_total_qty THEN
    v_new_status := 'dispatched';
  ELSIF v_total_dispatched > 0 THEN
    v_new_status := 'partially_dispatched';
  ELSIF v_status IN ('dispatched', 'partially_dispatched') THEN
    v_new_status := 'confirmed';
  ELSE
    RETURN;
  END IF;

  IF v_new_status <> v_status THEN
    UPDATE public.sales_orders
       SET status = v_new_status, updated_at = now()
     WHERE id = p_order_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sales_order_recalc_status(uuid) FROM PUBLIC, anon, authenticated;

-- 2. Order lines drive the status -----------------------------------------------

CREATE OR REPLACE FUNCTION public.sales_order_items_recalc_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.sales_order_recalc_status(NEW.order_id);
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.order_id IS DISTINCT FROM NEW.order_id) THEN
    PERFORM public.sales_order_recalc_status(OLD.order_id);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE TRIGGER trg_sales_order_items_recalc_status
  AFTER INSERT OR DELETE OR UPDATE OF quantity_dozens, quantity_dispatched, order_id
  ON public.sales_order_items
  FOR EACH ROW EXECUTE FUNCTION public.sales_order_items_recalc_status();

-- 3. Dispatch lines keep the dispatched quantity (NULL-safe) ---------------------
--    Same trigger (update_dispatched_qty) as 20260112200932; only the body
--    changes. Its UPDATE of quantity_dispatched fires the trigger above.

CREATE OR REPLACE FUNCTION public.update_order_item_dispatched_qty()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.sales_order_items
       SET quantity_dispatched = COALESCE(quantity_dispatched, 0) + NEW.quantity_dozens
     WHERE id = NEW.order_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.sales_order_items
       SET quantity_dispatched = COALESCE(quantity_dispatched, 0) - OLD.quantity_dozens
     WHERE id = OLD.order_item_id;
  ELSIF OLD.order_item_id IS DISTINCT FROM NEW.order_item_id THEN
    UPDATE public.sales_order_items
       SET quantity_dispatched = COALESCE(quantity_dispatched, 0) - OLD.quantity_dozens
     WHERE id = OLD.order_item_id;
    UPDATE public.sales_order_items
       SET quantity_dispatched = COALESCE(quantity_dispatched, 0) + NEW.quantity_dozens
     WHERE id = NEW.order_item_id;
  ELSE
    UPDATE public.sales_order_items
       SET quantity_dispatched = COALESCE(quantity_dispatched, 0) - OLD.quantity_dozens + NEW.quantity_dozens
     WHERE id = NEW.order_item_id;
  END IF;
  RETURN NULL;
END;
$$;

-- 4. Retire the competing status trigger from 20260403035012 --------------------

DROP TRIGGER IF EXISTS trg_update_order_status_on_dispatch ON public.sales_dispatch_items;
DROP FUNCTION IF EXISTS public.update_sales_order_status_on_dispatch();

-- 5. Backfill every open order -------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT so.id
      FROM public.sales_orders so
     WHERE so.status NOT IN ('cancelled', 'completed', 'delivered')
       AND EXISTS (SELECT 1 FROM public.sales_order_items soi WHERE soi.order_id = so.id)
  LOOP
    PERFORM public.sales_order_recalc_status(r.id);
  END LOOP;
END;
$$;
