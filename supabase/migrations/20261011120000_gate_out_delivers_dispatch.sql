-- ============================================================================
-- Gate out delivers the dispatch
-- ============================================================================
-- When a sales gate pass goes Out at the gate (a matching scan, a manager's
-- release of a held pass, or a backfilled paper pass), the dispatches on it
-- used to become In Transit and someone then set Delivered by hand on the
-- dispatch list. Now the gate scan sets them to Delivered straight away and
-- stamps the actual delivery date with the gate-out day (factory time).
--
-- Only Pending and In Transit dispatches change. Delivered, Acknowledged and
-- Returned ones are never touched, and a delivery date already on the row is
-- kept. The status dropdown on the dispatch pages still works for corrections.
--
-- Redefines gate_pass_mark_out from 20260929120000_gate_pass_phase2_3.sql;
-- every other branch is unchanged. Grants are preserved by CREATE OR REPLACE.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gate_pass_mark_out(p_id uuid, p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  i public.gate_pass_items%ROWTYPE;
  v_day date := (p_at AT TIME ZONE 'Asia/Karachi')::date;
  v_loc uuid;
BEGIN
  UPDATE public.gate_passes
     SET status = 'out', gate_out_by = v_uid, gate_out_at = p_at, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;

  IF g.pass_type = 'sample' THEN
    INSERT INTO public.stock_movements
      (movement_number, movement_type, movement_date, item_type, item_id, quantity,
       reference_type, reference_id, reference_number, remarks, status, created_by)
    SELECT '', 'issue', v_day, 'finished_goods', it.product_id,
           CASE it.uom WHEN 'pcs' THEN it.quantity / 12 ELSE it.quantity END,
           'gate_pass', g.id, g.pass_number,
           'Sample to ' || g.party_name || ' (' || it.quantity || ' ' || it.uom || ')',
           'completed', v_uid
      FROM public.gate_pass_items it
     WHERE it.gate_pass_id = g.id AND it.product_id IS NOT NULL AND it.quantity > 0;
  ELSIF g.pass_type = 'sales' THEN
    -- The gate scan is the delivery: the dispatches on the pass are Delivered,
    -- dated on the day the vehicle left.
    UPDATE public.sales_dispatches sd
       SET delivery_status = 'delivered',
           actual_delivery_date = COALESCE(sd.actual_delivery_date, v_day)
      FROM public.gate_pass_dispatches gd
     WHERE gd.gate_pass_id = g.id AND sd.id = gd.dispatch_id
       AND sd.delivery_status IN ('pending', 'in_transit');
  ELSIF g.pass_type IN ('returnable','job_work') THEN
    v_loc := public.gate_pass_location(CASE g.pass_type WHEN 'returnable' THEN 'GP-REPAIR' ELSE 'GP-JOBWORK' END);
    FOR i IN SELECT * FROM public.gate_pass_items WHERE gate_pass_id = g.id AND quantity > 0 LOOP
      PERFORM public.gate_pass_move('transfer', i.product_id, i.item_id, i.quantity, NULL, v_loc, v_day, g,
        initcap(replace(g.pass_type, '_', ' ')) || ' to ' || g.party_name);
      IF i.spare_part_id IS NOT NULL THEN
        UPDATE public.spare_parts SET current_stock = COALESCE(current_stock, 0) - i.quantity::integer
         WHERE id = i.spare_part_id;
      END IF;
    END LOOP;
  ELSIF g.pass_type = 'scrap' THEN
    INSERT INTO public.gate_pass_scrap_entries
      (category_id, entry_type, entry_date, quantity, gate_pass_id, remarks, created_by)
    SELECT it.scrap_category_id, 'out', v_day, it.quantity, g.id,
           g.pass_number || ' to ' || g.party_name, v_uid
      FROM public.gate_pass_items it
     WHERE it.gate_pass_id = g.id AND it.scrap_category_id IS NOT NULL AND it.quantity > 0;
  END IF;

  PERFORM public.gate_pass_log(p_id, 'out', CASE WHEN g.is_backfill THEN 'Left on the paper pass' ELSE 'Vehicle left the gate' END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gate_pass_mark_out(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
