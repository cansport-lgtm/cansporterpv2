-- ============================================================================
-- Intermediate products (compounds) in Material Consumption
-- ----------------------------------------------------------------------------
-- Some outputs are not finished goods but intermediates — e.g. H72 COMPOUND is
-- mixed from SMOKE RUBBER (+ chemicals) and then itself consumed to make other
-- products. Such an item must exist on BOTH sides of the module:
--
--   as a consumption_product      — it has a BOM (rubber + chemicals per kg)
--                                   and daily production entries (kg mixed);
--   as a consumption_raw_material — it appears on the stock-closing sheet and
--                                   in finished-product BOMs, so its own
--                                   consumption falls out of the usual
--                                   opening + receipts − closing count.
--
-- The two sides are linked by consumption_raw_materials.source_product_id.
-- For a linked ("intermediate") material, receipts are NOT purchases: they are
-- the linked product's production entries in the closing period, summed by the
-- same window logic the GRN sync uses. Raw materials therefore appear only in
-- the compound's BOM and the compound only in finished-product BOMs — nothing
-- is double-counted, and mixing loss vs molding loss become separately visible.
--
-- This migration:
--   1. Adds consumption_raw_materials.source_product_id (one material per
--      product) marking the material as an intermediate.
--   2. Extends consumption_receipt_for_closing() to add production-entry
--      quantities of the linked product to the period receipt.
--   3. v_consumption_production_receipts — daily production receipts per
--      intermediate material, read live by the stock-closing UI.
--   4. Resyncs saved closing rows when production entries change later,
--      mirroring the GRN resync triggers.
--   5. Excludes intermediates from the raw-material stock valuation in the
--      periodic COGS RPCs: their value is already inside WIP (the inputs were
--      debited to WIP when consumed), so valuing compound stock as RM
--      inventory would count it twice.
-- ============================================================================

-- 1. Link an intermediate material to the product it is produced as ----------
ALTER TABLE public.consumption_raw_materials
  ADD COLUMN IF NOT EXISTS source_product_id UUID
  REFERENCES public.consumption_products(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_consumption_rm_source_product
  ON public.consumption_raw_materials (source_product_id)
  WHERE source_product_id IS NOT NULL;

COMMENT ON COLUMN public.consumption_raw_materials.source_product_id IS
  'Set when this material is an intermediate (e.g. a compound): the consumption_product whose production entries supply its receipts. NULL for purchased raw materials.';

-- 2. Period receipt = GRNs + linked-product production in the window ---------
-- Window is (previous closing date, closing date], same as before. Purchased
-- materials keep GRN-only receipts (no linked product); intermediates are
-- never purchased, so in practice each material draws from one source.
CREATE OR REPLACE FUNCTION public.consumption_receipt_for_closing(p_material uuid, p_closing_date date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prev date;
  v_grn numeric;
  v_produced numeric := 0;
  v_source_product uuid;
BEGIN
  SELECT MAX(closing_date) INTO v_prev
    FROM public.consumption_stock_closing
   WHERE raw_material_id = p_material
     AND closing_date < p_closing_date;

  IF v_prev IS NULL THEN
    v_prev := p_closing_date - 1;
  END IF;

  SELECT COALESCE(SUM(gi.quantity_received), 0) INTO v_grn
    FROM public.grn_items gi
    JOIN public.goods_receipt_notes g ON g.id = gi.grn_id
    JOIN public.items i               ON i.id = gi.item_id
   WHERE g.status = 'completed'
     AND g.receipt_date > v_prev
     AND g.receipt_date <= p_closing_date
     AND i.consumption_raw_material_id = p_material;

  SELECT source_product_id INTO v_source_product
    FROM public.consumption_raw_materials
   WHERE id = p_material;

  IF v_source_product IS NOT NULL THEN
    SELECT COALESCE(SUM(pe.quantity_produced), 0) INTO v_produced
      FROM public.consumption_production_entry pe
     WHERE pe.product_id = v_source_product
       AND pe.entry_date > v_prev
       AND pe.entry_date <= p_closing_date;
  END IF;

  RETURN v_grn + v_produced;
END;
$$;

-- 3. Daily production receipts per intermediate material ---------------------
CREATE OR REPLACE VIEW public.v_consumption_production_receipts
WITH (security_invoker = on) AS
SELECT
  rm.id             AS raw_material_id,
  pe.entry_date     AS receipt_date,
  SUM(pe.quantity_produced) AS receipt_quantity
FROM public.consumption_production_entry pe
JOIN public.consumption_raw_materials rm ON rm.source_product_id = pe.product_id
WHERE pe.quantity_produced > 0
GROUP BY rm.id, pe.entry_date;

-- 4. Refresh saved closing rows when production entries change later ---------
-- resync_closing_receipt() (20260727130000) already targets the closing row
-- whose period covers the given date and recomputes via
-- consumption_receipt_for_closing(), which now includes production.
CREATE OR REPLACE FUNCTION public.on_production_entry_resync_closing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_material uuid;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT id INTO v_material FROM public.consumption_raw_materials
     WHERE source_product_id = NEW.product_id;
    PERFORM public.resync_closing_receipt(v_material, NEW.entry_date);
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT id INTO v_material FROM public.consumption_raw_materials
     WHERE source_product_id = OLD.product_id;
    PERFORM public.resync_closing_receipt(v_material, OLD.entry_date);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_entry_resync_closing ON public.consumption_production_entry;
CREATE TRIGGER trg_production_entry_resync_closing
  AFTER INSERT OR UPDATE OR DELETE ON public.consumption_production_entry
  FOR EACH ROW
  EXECUTE FUNCTION public.on_production_entry_resync_closing();

-- Newly linking/unlinking a material to a product changes where its receipts
-- come from — refresh that material's post-cutover closing rows.
CREATE OR REPLACE FUNCTION public.on_rm_source_product_change_resync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  IF OLD.source_product_id IS NOT DISTINCT FROM NEW.source_product_id THEN
    RETURN NULL;
  END IF;
  FOR r IN
    SELECT closing_date FROM public.consumption_stock_closing
     WHERE raw_material_id = NEW.id
       AND closing_date >= public.consumption_grn_cutover()
  LOOP
    PERFORM public.resync_closing_receipt(NEW.id, r.closing_date);
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rm_source_product_resync ON public.consumption_raw_materials;
CREATE TRIGGER trg_rm_source_product_resync
  AFTER UPDATE OF source_product_id ON public.consumption_raw_materials
  FOR EACH ROW
  EXECUTE FUNCTION public.on_rm_source_product_change_resync();

-- 5. Periodic COGS: intermediate stock is WIP, not RM inventory --------------
-- Same bodies as 20260726150000 / 20260726130000 with
-- "rm.source_product_id IS NULL" added to the RM valuation joins.
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
  FROM prev_rm JOIN public.consumption_raw_materials rm ON rm.id = prev_rm.raw_material_id
  WHERE rm.source_product_id IS NULL;

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
  FROM curr_rm JOIN public.consumption_raw_materials rm ON rm.id = curr_rm.raw_material_id
  WHERE rm.source_product_id IS NULL;

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

  -- Previous RM closing: latest consumption_stock_closing per material BEFORE
  -- p_from. Intermediates (source_product_id set) are excluded — their value
  -- is already inside WIP.
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
  WHERE r.closing_quantity <> 0
    AND rm.source_product_id IS NULL;

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
  WHERE r.closing_quantity <> 0
    AND rm.source_product_id IS NULL;

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
