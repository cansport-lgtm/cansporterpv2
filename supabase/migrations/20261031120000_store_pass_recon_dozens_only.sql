-- Daily store ↔ gate reconciliation: discrepancies are raised on dozens only.
--
-- Packages (carton/bora) are shown for reference but no longer decide a
-- discrepancy: a dispatch matches when the dozens match.
--   SP_VS_GP  store issued dozens  vs  gate dozens (guard's counted dozens, else the printed gate pass dozens)
--   SP_VS_DC  store issued dozens  vs  dispatch dozens
-- Same signature and row type as 20261009120000_store_pass_simplify.sql, so it is replaced in place.

CREATE OR REPLACE FUNCTION public.store_pass_reconcile(p_from date, p_to date)
RETURNS TABLE (
  dispatch_id uuid, dispatch_number text, dispatch_date date, dispatch_created_at timestamptz,
  delivery_status text, customer_name text, order_numbers text,
  dc_quantity numeric, dc_packages numeric,
  store_pass_id uuid, sp_number text, sp_status text, sp_issued_at timestamptz, sp_date date,
  sp_dispatch_plan_no text, sp_received_by text, sp_dispatch_count integer,
  sp_quantity numeric, sp_packages numeric,
  gate_pass_id uuid, gp_number text, gp_status text, gp_held_at timestamptz, gate_out_at timestamptz, out_date date,
  gp_quantity numeric, gp_packages numeric, gp_counted_packages numeric, gp_counted_quantity numeric,
  stage text,
  cancelled_sp_number text, cancelled_sp_reason text, cancelled_sp_at timestamptz,
  codes text[], high_codes integer, open_high integer, open_medium integer,
  explained jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT t.*,
           public.store_pass_pk_date(t.sp_issued_at) AS sp_date,
           public.store_pass_pk_date(t.gate_out_at) AS out_date,
           c.pass_number AS cancelled_sp_number, c.cancel_reason AS cancelled_sp_reason, c.cancelled_at AS cancelled_sp_at
      FROM public.v_store_gate_tracking t
      LEFT JOIN LATERAL (
        SELECT sp.pass_number, sp.cancel_reason, sp.cancelled_at
          FROM public.store_pass_dispatches spd
          JOIN public.store_passes sp ON sp.id = spd.store_pass_id
         WHERE spd.dispatch_id = t.dispatch_id AND sp.status = 'cancelled' AND sp.issued_at IS NOT NULL
           AND public.store_pass_pk_date(sp.cancelled_at) BETWEEN p_from AND p_to
         ORDER BY sp.cancelled_at DESC LIMIT 1
      ) c ON true
     WHERE t.dispatch_id IN (SELECT public.store_pass_recon_dispatch_ids(p_from, p_to))
  ),
  coded AS (
    SELECT b.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN b.gate_out_at IS NOT NULL AND b.sp_status IS DISTINCT FROM 'issued' THEN 'OUT_NO_SP' END,
             CASE WHEN b.sp_status = 'issued' AND b.stage IN ('issued','on_gate_pass','held') THEN 'SP_NOT_OUT' END,
             CASE WHEN b.sp_status = 'issued' AND b.gate_out_at IS NOT NULL AND b.sp_quantity IS NOT NULL
                       AND COALESCE(b.gp_counted_quantity, b.gp_quantity) IS DISTINCT FROM b.sp_quantity
                  THEN 'SP_VS_GP' END,
             CASE WHEN b.sp_status = 'issued' AND b.sp_quantity IS NOT NULL
                       AND b.sp_quantity <> b.dc_quantity THEN 'SP_VS_DC' END,
             CASE WHEN b.cancelled_sp_number IS NOT NULL THEN 'SP_CANCELLED_AFTER_ISSUE' END,
             CASE WHEN b.sp_date IS NOT NULL AND b.out_date IS NOT NULL AND b.sp_date <> b.out_date THEN 'CROSS_DAY' END,
             CASE WHEN b.stage IN ('no_store_pass','draft') AND b.delivery_status = 'pending' THEN 'DC_PENDING' END
           ]::text[], NULL) AS codes
      FROM base b
  )
  SELECT c.dispatch_id, c.dispatch_number, c.dispatch_date, c.dispatch_created_at,
         c.delivery_status, c.customer_name, c.order_numbers,
         c.dc_quantity, c.dc_packages,
         c.store_pass_id, c.sp_number, c.sp_status, c.sp_issued_at, c.sp_date,
         c.sp_dispatch_plan_no, c.sp_received_by, c.sp_dispatch_count::integer,
         c.sp_quantity, c.sp_packages,
         c.gate_pass_id, c.gp_number, c.gp_status, c.gp_held_at, c.gate_out_at, c.out_date,
         c.gp_quantity, c.gp_packages, c.gp_counted_packages, c.gp_counted_quantity,
         c.stage,
         c.cancelled_sp_number, c.cancelled_sp_reason, c.cancelled_sp_at,
         c.codes,
         (SELECT count(*) FROM unnest(c.codes) x WHERE public.store_pass_code_severity(x) = 'high')::integer,
         (SELECT count(*) FROM unnest(c.codes) x
           WHERE public.store_pass_code_severity(x) = 'high'
             AND NOT EXISTS (SELECT 1 FROM public.store_pass_recon_notes n WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = x))::integer,
         (SELECT count(*) FROM unnest(c.codes) x
           WHERE public.store_pass_code_severity(x) = 'medium'
             AND NOT EXISTS (SELECT 1 FROM public.store_pass_recon_notes n WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = x))::integer,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('code', n.discrepancy_code, 'note', n.note,
                                                       'by', u.full_name, 'at', n.resolved_at) ORDER BY n.resolved_at)
                     FROM public.store_pass_recon_notes n
                     LEFT JOIN public.app_users u ON u.id = n.resolved_by
                    WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = ANY (c.codes)), '[]'::jsonb)
    FROM coded c
  UNION ALL
  -- Issued store passes not linked to any dispatch: nothing to compare them with yet.
  SELECT NULL, NULL, NULL, NULL,
         NULL, NULL, NULL,
         NULL, NULL,
         sp.id, sp.pass_number, sp.status, sp.issued_at, public.store_pass_pk_date(sp.issued_at),
         sp.dispatch_plan_no, sp.received_by_name, 0,
         (SELECT sum(i.quantity) FROM public.store_pass_items i WHERE i.store_pass_id = sp.id),
         (SELECT sum(i.packages) FROM public.store_pass_items i WHERE i.store_pass_id = sp.id),
         NULL, NULL, NULL, NULL, NULL, NULL,
         NULL, NULL, NULL, NULL,
         'unlinked',
         NULL, NULL, NULL,
         ARRAY['SP_UNLINKED'], 0, 0, 1,
         '[]'::jsonb
    FROM public.store_passes sp
   WHERE sp.id IN (SELECT public.store_pass_unlinked(p_from, p_to))
   ORDER BY 2 NULLS LAST, 11;
$$;
