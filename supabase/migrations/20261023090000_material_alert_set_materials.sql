-- Products with no materials: the alert now says "Set the materials" and
-- names the products, instead of a count of "materials not set".

CREATE OR REPLACE FUNCTION public.material_check_run(
  p_source_type text, p_source_id uuid, p_actor uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev       public.material_checks%ROWTYPE;
  v_rows_json  jsonb;
  v_id         uuid;
  v_number     text;
  v_label      text;
  v_link       text;
  v_sig        text;
  v_rows       integer;
  v_short      integer;
  v_below      integer;
  v_unknown    integer;
  v_not_set    integer;
  v_old        integer;
  v_ok         integer;
  v_title      text;
  v_msg        text;
  v_reason     text;
  v_merge      boolean;
  v_bad        boolean;
  v_not_set_names text;
BEGIN
  IF p_source_type = 'sales_order' THEN
    SELECT so.order_number,
           CASE so.sales_segment::text WHEN 'domestic' THEN 'Domestic'
                                       WHEN 'export' THEN 'Export' ELSE 'Private Label' END,
           CASE so.sales_segment::text WHEN 'domestic' THEN '/domestic/orders'
                                       WHEN 'export' THEN '/export/orders' ELSE '/sales/orders' END
      INTO v_number, v_label, v_link
      FROM public.sales_orders so WHERE so.id = p_source_id;
  ELSE
    SELECT d.order_number, 'Distributor', '/distributor/approvals'
      INTO v_number, v_label, v_link
      FROM public.distributor_orders d WHERE d.id = p_source_id;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_rows_json
    FROM public.material_check_compute(p_source_type, p_source_id) c;

  SELECT count(*),
         count(*) FILTER (WHERE r.result = 'short'),
         count(*) FILTER (WHERE r.result = 'below_min'),
         count(*) FILTER (WHERE r.result = 'unknown'),
         count(*) FILTER (WHERE r.result = 'not_set'),
         count(*) FILTER (WHERE r.count_is_old AND r.result <> 'unknown'),
         count(*) FILTER (WHERE r.result = 'ok'),
         md5(coalesce(string_agg(coalesce(r.item_id::text, r.item_name) || ':' || r.needed::text || ':' || r.result
                                 || ':' || r.count_is_old::text, '|' ORDER BY coalesce(r.item_id::text, r.item_name)), ''))
    INTO v_rows, v_short, v_below, v_unknown, v_not_set, v_old, v_ok, v_sig
    FROM public.material_check_rows(v_rows_json) r;

  SELECT * INTO v_prev FROM public.material_checks
   WHERE source_type = p_source_type AND source_id = p_source_id AND status = 'open'
   ORDER BY created_at DESC LIMIT 1;

  -- Nothing to check yet (e.g. header saved before its lines).
  IF v_rows = 0 THEN
    RETURN v_prev.id;
  END IF;

  -- Same result as the open check: keep it, no new alert.
  IF v_prev.id IS NOT NULL AND v_prev.signature = v_sig THEN
    RETURN v_prev.id;
  END IF;

  v_merge := v_prev.id IS NOT NULL AND v_prev.created_at > now() - interval '2 minutes';
  v_reason := CASE WHEN v_prev.id IS NULL THEN 'confirmed'
                   WHEN v_merge THEN v_prev.reason
                   ELSE 'updated' END;
  v_bad := v_short + v_below + v_unknown + v_not_set + v_old > 0;

  INSERT INTO public.material_checks
    (source_type, source_id, order_number, order_label, order_link, reason,
     short_count, below_min_count, unknown_count, not_set_count, old_count, ok_count,
     signature, created_by)
  VALUES
    (p_source_type, p_source_id, v_number, v_label, v_link, v_reason,
     v_short, v_below, v_unknown, v_not_set, v_old, v_ok, v_sig, p_actor)
  RETURNING id INTO v_id;

  -- Purchase follow-up already recorded for an item carries over.
  INSERT INTO public.material_check_lines
    (check_id, item_id, item_name, unit, slots, used_by, needed, stock_now, last_count_date,
     stock_after, min_stock, max_stock, result, count_is_old, suggest_qty,
     purchase_status, po_reference, status_updated_by, status_updated_at)
  SELECT v_id, r.item_id, r.item_name, r.unit, r.slots, r.used_by, r.needed, r.stock_now,
         r.last_count_date, r.stock_after, r.min_stock, r.max_stock, r.result, r.count_is_old,
         r.suggest_qty,
         coalesce(pl.purchase_status, 'new'), pl.po_reference, pl.status_updated_by, pl.status_updated_at
    FROM public.material_check_rows(v_rows_json) r
    LEFT JOIN public.material_check_lines pl
      ON v_prev.id IS NOT NULL AND pl.check_id = v_prev.id AND pl.item_id = r.item_id;

  IF v_prev.id IS NOT NULL THEN
    UPDATE public.material_checks SET status = 'superseded' WHERE id = v_prev.id;
  END IF;

  -- Alert only when something needs attention (or an earlier alert changed).
  IF v_bad OR v_prev.id IS NOT NULL THEN
    v_title := CASE
      WHEN v_reason = 'updated' THEN 'Updated - ' || coalesce(v_number, v_label) || ' re-checked'
      WHEN v_short > 0 THEN 'Material short - ' || coalesce(v_number, v_label)
      WHEN v_below > 0 THEN 'Below min stock - ' || coalesce(v_number, v_label)
      WHEN v_not_set > 0 AND v_unknown + v_old = 0 THEN 'Set the materials - ' || coalesce(v_number, v_label)
      ELSE 'Stock check warning - ' || coalesce(v_number, v_label)
    END;

    SELECT string_agg(x.item_name, ', ' ORDER BY x.item_name) INTO v_not_set_names
      FROM public.material_check_rows(v_rows_json) x
     WHERE x.result = 'not_set';

    SELECT concat_ws(' | ',
             CASE WHEN v_short > 0 THEN v_short || ' short' END,
             CASE WHEN v_below > 0 THEN v_below || ' below min stock' END,
             CASE WHEN v_unknown > 0 THEN v_unknown || ' stock unknown' END,
             CASE WHEN v_not_set > 0 THEN 'Set the materials for ' || v_not_set_names || ' on Products / SKUs' END,
             CASE WHEN v_old > 0 THEN v_old || ' old count' END,
             CASE WHEN NOT v_bad THEN 'All materials OK now' END)
           || coalesce('. ' || (
             SELECT string_agg(s.item_name || ' short by ' || rtrim(to_char(-s.stock_after, 'FM999,999,990.###'), '.') || ' ' || coalesce(s.unit, ''), '; ')
               FROM (SELECT * FROM public.material_check_rows(v_rows_json) x
                      WHERE x.result = 'short' ORDER BY x.stock_after LIMIT 3) s), '')
           || '. ' || v_label || ' order.'
      INTO v_msg;

    IF v_merge THEN
      UPDATE public.notifications
         SET title = left(v_title, 200),
             message = v_msg,
             type = CASE WHEN v_bad THEN 'error' ELSE 'info' END,
             link = '/purchase/material-shortages?check=' || v_id,
             reference_id = v_id
       WHERE reference_type = 'material_check' AND reference_id = v_prev.id;
      IF NOT FOUND AND v_bad THEN
        PERFORM public.notify_role(public.material_alert_roles(), left(v_title, 200), v_msg, 'error', 'stock',
          '/purchase/material-shortages?check=' || v_id, 'material_check', v_id, p_actor, NULL);
      END IF;
    ELSE
      PERFORM public.notify_role(
        public.material_alert_roles(),
        left(v_title, 200),
        v_msg,
        CASE WHEN v_bad THEN 'error' ELSE 'info' END,
        'stock',
        '/purchase/material-shortages?check=' || v_id,
        'material_check',
        v_id,
        p_actor,
        NULL);
    END IF;
  END IF;

  RETURN v_id;
END;
$$;

