-- ============================================================
-- Extend accounting_periodic_cogs_inputs with a breakup of the
-- "already posted COGS" figure: per-dispatch (domestic_sales_cogs)
-- vs prior periodic adjustments (periodic_cogs), with voucher
-- counts, so the Reconciliation-to-GL section can show the split.
-- ============================================================
DROP FUNCTION IF EXISTS public.accounting_periodic_cogs_inputs(DATE, DATE);

CREATE OR REPLACE FUNCTION public.accounting_periodic_cogs_inputs(p_from DATE, p_to DATE)
RETURNS TABLE (
  previous_rm_value NUMERIC,
  current_rm_value NUMERIC,
  previous_fg_wip_value NUMERIC,
  current_fg_wip_value NUMERIC,
  rm_purchases_value NUMERIC,
  production_additions NUMERIC,
  already_posted_cogs NUMERIC,
  already_posted_dispatch NUMERIC,
  already_posted_periodic NUMERIC,
  dispatch_voucher_count INTEGER,
  periodic_voucher_count INTEGER,
  previous_fg_wip_items INTEGER,
  current_fg_wip_items INTEGER,
  previous_rm_items INTEGER,
  current_rm_items INTEGER,
  unpriced_fg_wip_count INTEGER,
  unpriced_rm_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prev_rm  NUMERIC := 0; v_curr_rm NUMERIC := 0;
  v_prev_fg  NUMERIC := 0; v_curr_fg NUMERIC := 0;
  v_purch    NUMERIC := 0; v_prod    NUMERIC := 0;
  v_already_dispatch NUMERIC := 0; v_already_periodic NUMERIC := 0;
  v_dispatch_cnt INT := 0; v_periodic_cnt INT := 0;
  v_prev_fg_cnt INT := 0; v_curr_fg_cnt INT := 0;
  v_prev_rm_cnt INT := 0; v_curr_rm_cnt INT := 0;
  v_unp_fg   INT := 0; v_unp_rm INT := 0;
  v_rm_inv_account UUID;
BEGIN
  WITH prev_fg AS (
    SELECT DISTINCT ON (planning_item_id) planning_item_id, closing_quantity
    FROM public.daily_stock_closing WHERE closing_date < p_from
    ORDER BY planning_item_id, closing_date DESC
  )
  SELECT
    COALESCE(SUM(prev_fg.closing_quantity * pi.costing_value), 0),
    COUNT(*) FILTER (WHERE prev_fg.closing_quantity > 0),
    COUNT(*) FILTER (WHERE prev_fg.closing_quantity > 0 AND COALESCE(pi.costing_value, 0) = 0)
    INTO v_prev_fg, v_prev_fg_cnt, v_unp_fg
  FROM prev_fg JOIN public.planning_items pi ON pi.id = prev_fg.planning_item_id;

  WITH curr_fg AS (
    SELECT DISTINCT ON (planning_item_id) planning_item_id, closing_quantity
    FROM public.daily_stock_closing WHERE closing_date BETWEEN p_from AND p_to
    ORDER BY planning_item_id, closing_date DESC
  )
  SELECT
    COALESCE(SUM(curr_fg.closing_quantity * pi.costing_value), 0),
    COUNT(*) FILTER (WHERE curr_fg.closing_quantity > 0),
    v_unp_fg + COUNT(*) FILTER (WHERE curr_fg.closing_quantity > 0 AND COALESCE(pi.costing_value, 0) = 0)
    INTO v_curr_fg, v_curr_fg_cnt, v_unp_fg
  FROM curr_fg JOIN public.planning_items pi ON pi.id = curr_fg.planning_item_id;

  WITH prev_rm AS (
    SELECT DISTINCT ON (raw_material_id) raw_material_id, closing_quantity
    FROM public.consumption_stock_closing WHERE closing_date < p_from
    ORDER BY raw_material_id, closing_date DESC
  )
  SELECT
    COALESCE(SUM(prev_rm.closing_quantity * rm.cost_value), 0),
    COUNT(*) FILTER (WHERE prev_rm.closing_quantity > 0),
    COUNT(*) FILTER (WHERE prev_rm.closing_quantity > 0 AND COALESCE(rm.cost_value, 0) = 0)
    INTO v_prev_rm, v_prev_rm_cnt, v_unp_rm
  FROM prev_rm JOIN public.consumption_raw_materials rm ON rm.id = prev_rm.raw_material_id;

  WITH curr_rm AS (
    SELECT DISTINCT ON (raw_material_id) raw_material_id, closing_quantity
    FROM public.consumption_stock_closing WHERE closing_date BETWEEN p_from AND p_to
    ORDER BY raw_material_id, closing_date DESC
  )
  SELECT
    COALESCE(SUM(curr_rm.closing_quantity * rm.cost_value), 0),
    COUNT(*) FILTER (WHERE curr_rm.closing_quantity > 0),
    v_unp_rm + COUNT(*) FILTER (WHERE curr_rm.closing_quantity > 0 AND COALESCE(rm.cost_value, 0) = 0)
    INTO v_curr_rm, v_curr_rm_cnt, v_unp_rm
  FROM curr_rm JOIN public.consumption_raw_materials rm ON rm.id = curr_rm.raw_material_id;

  SELECT account_id INTO v_rm_inv_account
  FROM public.accounting_default_accounts WHERE key = 'raw_material_inventory';

  IF v_rm_inv_account IS NOT NULL THEN
    SELECT COALESCE(SUM(l.debit_amount - l.credit_amount), 0) INTO v_purch
    FROM public.accounting_voucher_lines l
    JOIN public.accounting_vouchers v ON v.id = l.voucher_id
    WHERE l.account_id = v_rm_inv_account
      AND v.voucher_date BETWEEN p_from AND p_to
      AND v.status = 'posted'
      AND v.source_module NOT IN ('production_consumption', 'production_output', 'periodic_cogs');
  END IF;

  SELECT COALESCE(SUM(total_amount), 0) INTO v_prod
  FROM public.accounting_vouchers
  WHERE source_module = 'production_output' AND voucher_date BETWEEN p_from AND p_to;

  SELECT
    COALESCE(SUM(total_amount) FILTER (WHERE source_module = 'domestic_sales_cogs'), 0),
    COALESCE(SUM(total_amount) FILTER (WHERE source_module = 'periodic_cogs'), 0),
    COUNT(*) FILTER (WHERE source_module = 'domestic_sales_cogs'),
    COUNT(*) FILTER (WHERE source_module = 'periodic_cogs')
    INTO v_already_dispatch, v_already_periodic, v_dispatch_cnt, v_periodic_cnt
  FROM public.accounting_vouchers
  WHERE source_module IN ('domestic_sales_cogs', 'periodic_cogs') AND voucher_date BETWEEN p_from AND p_to;

  previous_rm_value := v_prev_rm; current_rm_value := v_curr_rm;
  previous_fg_wip_value := v_prev_fg; current_fg_wip_value := v_curr_fg;
  rm_purchases_value := v_purch;
  production_additions := v_prod;
  already_posted_cogs := v_already_dispatch + v_already_periodic;
  already_posted_dispatch := v_already_dispatch;
  already_posted_periodic := v_already_periodic;
  dispatch_voucher_count := v_dispatch_cnt;
  periodic_voucher_count := v_periodic_cnt;
  previous_fg_wip_items := v_prev_fg_cnt; current_fg_wip_items := v_curr_fg_cnt;
  previous_rm_items := v_prev_rm_cnt; current_rm_items := v_curr_rm_cnt;
  unpriced_fg_wip_count := v_unp_fg; unpriced_rm_count := v_unp_rm;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.accounting_periodic_cogs_inputs(DATE, DATE) TO anon, authenticated, service_role;
