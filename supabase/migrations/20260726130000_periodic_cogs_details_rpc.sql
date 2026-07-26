-- ============================================================
-- Periodic COGS detail RPC — item/voucher level drill-down for
-- /accounting/periodic-cogs. Returns the exact rows behind each
-- aggregate figure of accounting_periodic_cogs_inputs so users
-- can audit the calculation.
-- ============================================================
DROP FUNCTION IF EXISTS public.accounting_periodic_cogs_details(DATE, DATE);

CREATE OR REPLACE FUNCTION public.accounting_periodic_cogs_details(p_from DATE, p_to DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prev_fg JSONB := '[]'::jsonb;
  v_curr_fg JSONB := '[]'::jsonb;
  v_prev_rm JSONB := '[]'::jsonb;
  v_curr_rm JSONB := '[]'::jsonb;
  v_purch   JSONB := '[]'::jsonb;
  v_already JSONB := '[]'::jsonb;
  v_prod    JSONB := '[]'::jsonb;
  v_rm_inv_account UUID;
BEGIN
  -- Previous FG/WIP closing: latest daily_stock_closing per item BEFORE p_from
  WITH prev_fg AS (
    SELECT DISTINCT ON (planning_item_id) planning_item_id, closing_date, closing_quantity
    FROM public.daily_stock_closing WHERE closing_date < p_from
    ORDER BY planning_item_id, closing_date DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code', pi.code, 'name', pi.name, 'unit', pi.unit,
      'closing_date', f.closing_date, 'qty', f.closing_quantity,
      'rate', COALESCE(pi.costing_value, 0),
      'value', f.closing_quantity * COALESCE(pi.costing_value, 0)
    ) ORDER BY pi.name), '[]'::jsonb)
    INTO v_prev_fg
  FROM prev_fg f JOIN public.planning_items pi ON pi.id = f.planning_item_id
  WHERE f.closing_quantity <> 0;

  -- Current FG/WIP closing: latest daily_stock_closing per item IN [p_from, p_to]
  WITH curr_fg AS (
    SELECT DISTINCT ON (planning_item_id) planning_item_id, closing_date, closing_quantity
    FROM public.daily_stock_closing WHERE closing_date BETWEEN p_from AND p_to
    ORDER BY planning_item_id, closing_date DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code', pi.code, 'name', pi.name, 'unit', pi.unit,
      'closing_date', f.closing_date, 'qty', f.closing_quantity,
      'rate', COALESCE(pi.costing_value, 0),
      'value', f.closing_quantity * COALESCE(pi.costing_value, 0)
    ) ORDER BY pi.name), '[]'::jsonb)
    INTO v_curr_fg
  FROM curr_fg f JOIN public.planning_items pi ON pi.id = f.planning_item_id
  WHERE f.closing_quantity <> 0;

  -- Previous RM closing: latest consumption_stock_closing per material BEFORE p_from
  WITH prev_rm AS (
    SELECT DISTINCT ON (raw_material_id) raw_material_id, closing_date, closing_quantity
    FROM public.consumption_stock_closing WHERE closing_date < p_from
    ORDER BY raw_material_id, closing_date DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code', rm.code, 'name', rm.name, 'unit', rm.unit,
      'closing_date', r.closing_date, 'qty', r.closing_quantity,
      'rate', COALESCE(rm.cost_value, 0),
      'value', r.closing_quantity * COALESCE(rm.cost_value, 0)
    ) ORDER BY rm.name), '[]'::jsonb)
    INTO v_prev_rm
  FROM prev_rm r JOIN public.consumption_raw_materials rm ON rm.id = r.raw_material_id
  WHERE r.closing_quantity <> 0;

  -- Current RM closing: latest consumption_stock_closing per material IN [p_from, p_to]
  WITH curr_rm AS (
    SELECT DISTINCT ON (raw_material_id) raw_material_id, closing_date, closing_quantity
    FROM public.consumption_stock_closing WHERE closing_date BETWEEN p_from AND p_to
    ORDER BY raw_material_id, closing_date DESC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'code', rm.code, 'name', rm.name, 'unit', rm.unit,
      'closing_date', r.closing_date, 'qty', r.closing_quantity,
      'rate', COALESCE(rm.cost_value, 0),
      'value', r.closing_quantity * COALESCE(rm.cost_value, 0)
    ) ORDER BY rm.name), '[]'::jsonb)
    INTO v_curr_rm
  FROM curr_rm r JOIN public.consumption_raw_materials rm ON rm.id = r.raw_material_id
  WHERE r.closing_quantity <> 0;

  -- RM purchase vouchers: net Dr − Cr on the RM Inventory account per voucher,
  -- same filter as the aggregate RPC (excludes consumption/output/periodic).
  SELECT account_id INTO v_rm_inv_account
  FROM public.accounting_default_accounts WHERE key = 'raw_material_inventory';

  IF v_rm_inv_account IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'voucher_number', t.voucher_number, 'voucher_date', t.voucher_date,
        'source_module', t.source_module, 'narration', t.narration,
        'amount', t.amount
      ) ORDER BY t.voucher_date, t.voucher_number), '[]'::jsonb)
      INTO v_purch
    FROM (
      SELECT v.id, v.voucher_number, v.voucher_date, v.source_module, v.narration,
             SUM(l.debit_amount - l.credit_amount) AS amount
      FROM public.accounting_voucher_lines l
      JOIN public.accounting_vouchers v ON v.id = l.voucher_id
      WHERE l.account_id = v_rm_inv_account
        AND v.voucher_date BETWEEN p_from AND p_to
        AND v.status = 'posted'
        AND v.source_module NOT IN ('production_consumption', 'production_output', 'periodic_cogs')
      GROUP BY v.id, v.voucher_number, v.voucher_date, v.source_module, v.narration
    ) t;
  END IF;

  -- Already-posted COGS vouchers in the period (per-dispatch + prior periodic)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'voucher_number', voucher_number, 'voucher_date', voucher_date,
      'source_module', source_module, 'narration', narration,
      'amount', total_amount
    ) ORDER BY voucher_date, voucher_number), '[]'::jsonb)
    INTO v_already
  FROM public.accounting_vouchers
  WHERE source_module IN ('domestic_sales_cogs', 'periodic_cogs')
    AND voucher_date BETWEEN p_from AND p_to;

  -- Production output JVs (informational reference on the page)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'voucher_number', voucher_number, 'voucher_date', voucher_date,
      'source_module', source_module, 'narration', narration,
      'amount', total_amount
    ) ORDER BY voucher_date, voucher_number), '[]'::jsonb)
    INTO v_prod
  FROM public.accounting_vouchers
  WHERE source_module = 'production_output' AND voucher_date BETWEEN p_from AND p_to;

  RETURN jsonb_build_object(
    'prev_fg', v_prev_fg,
    'curr_fg', v_curr_fg,
    'prev_rm', v_prev_rm,
    'curr_rm', v_curr_rm,
    'rm_purchases', v_purch,
    'already_posted', v_already,
    'production', v_prod
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accounting_periodic_cogs_details(DATE, DATE) TO anon, authenticated, service_role;
