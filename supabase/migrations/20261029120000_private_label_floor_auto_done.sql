-- ============================================================
-- Private Label Job Orders: auto-Done on the floor page
--
-- pljo_floor_add_progress now marks the order's production Done by itself
-- when an entry brings every size up to its ordered quantity, and returns
-- "completed": true. The floor page hides Done orders (a toggle shows them
-- again so a supervisor can Reopen one).
-- ============================================================

CREATE OR REPLACE FUNCTION public.pljo_floor_add_progress(
  p_pin text, p_job_order_id uuid, p_entries jsonb, p_entered_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status text := public.pljo_floor_check_pin(p_pin);
  v_entry jsonb;
  v_item uuid;
  v_dozens numeric;
  v_done numeric;
  v_count integer := 0;
  v_completed boolean := false;
BEGIN
  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.private_label_job_orders
                  WHERE id = p_job_order_id AND status = 'Issued') THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Entries must be a list';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_item := (v_entry ->> 'item_id')::uuid;
    v_dozens := round((v_entry ->> 'dozens')::numeric, 2);
    CONTINUE WHEN v_dozens IS NULL OR v_dozens = 0;

    IF NOT EXISTS (SELECT 1 FROM public.private_label_job_order_items
                    WHERE id = v_item AND job_order_id = p_job_order_id) THEN
      RAISE EXCEPTION 'Line does not belong to this job order';
    END IF;

    SELECT coalesce(sum(dozens), 0) INTO v_done
      FROM public.private_label_job_order_progress WHERE item_id = v_item;
    IF v_done + v_dozens < 0 THEN
      RAISE EXCEPTION 'A correction cannot take a size below 0 Dz done';
    END IF;

    INSERT INTO public.private_label_job_order_progress (job_order_id, item_id, dozens, entered_by_name)
    VALUES (p_job_order_id, v_item, v_dozens, nullif(trim(p_entered_by), ''));
    v_count := v_count + 1;
  END LOOP;

  -- Every size has reached its ordered quantity: production is done, and
  -- the order drops off the floor list.
  IF v_count > 0 AND NOT EXISTS (
       SELECT 1 FROM public.private_label_job_order_items i
        WHERE i.job_order_id = p_job_order_id
          AND i.quantity > (SELECT coalesce(sum(p.dozens), 0)
                              FROM public.private_label_job_order_progress p
                             WHERE p.item_id = i.id)) THEN
    UPDATE public.private_label_job_orders
       SET production_done_at = now(),
           production_done_by_name = nullif(trim(p_entered_by), '')
     WHERE id = p_job_order_id AND production_done_at IS NULL;
    v_completed := FOUND;
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'saved', v_count, 'completed', v_completed);
END;
$fn$;

-- Orders already at 100% before this change.
UPDATE public.private_label_job_orders o
   SET production_done_at = now()
 WHERE o.status = 'Issued'
   AND o.production_done_at IS NULL
   AND EXISTS (SELECT 1 FROM public.private_label_job_order_items i WHERE i.job_order_id = o.id)
   AND NOT EXISTS (
     SELECT 1 FROM public.private_label_job_order_items i
      WHERE i.job_order_id = o.id
        AND i.quantity > (SELECT coalesce(sum(p.dozens), 0)
                            FROM public.private_label_job_order_progress p
                           WHERE p.item_id = i.id));

-- Done only at 100%: marking Done is refused ("short") while any size is
-- below its ordered quantity. Reopening is always allowed.
CREATE OR REPLACE FUNCTION public.pljo_floor_set_done(
  p_pin text, p_job_order_id uuid, p_done boolean, p_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status text := public.pljo_floor_check_pin(p_pin);
BEGIN
  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.private_label_job_orders
                  WHERE id = p_job_order_id AND status = 'Issued') THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF p_done AND EXISTS (
       SELECT 1 FROM public.private_label_job_order_items i
        WHERE i.job_order_id = p_job_order_id
          AND i.quantity > (SELECT coalesce(sum(p.dozens), 0)
                              FROM public.private_label_job_order_progress p
                             WHERE p.item_id = i.id)) THEN
    RETURN jsonb_build_object('status', 'short');
  END IF;

  UPDATE public.private_label_job_orders
     SET production_done_at = CASE WHEN p_done THEN now() END,
         production_done_by_name = CASE WHEN p_done THEN nullif(trim(p_by), '') END
   WHERE id = p_job_order_id;
  RETURN jsonb_build_object('status', 'ok');
END;
$fn$;
