-- Latest stock closing per item as of a date, for the accounting inventory
-- valuation dashboards (/accounting/fg-inventory, /accounting/rm-inventory).
-- Unlike accounting_periodic_cogs_details this returns item ids (so the client
-- can join thresholds / departments / categories from the masters) and searches
-- ALL closing history, not a bounded window — so an item whose last closing is
-- months old still shows up with its stock instead of silently dropping out.
CREATE OR REPLACE FUNCTION public.accounting_inventory_snapshot(p_as_of DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'fg', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'item_id', s.planning_item_id,
        'closing_date', s.closing_date,
        'qty', s.closing_quantity))
      FROM (
        SELECT DISTINCT ON (planning_item_id) planning_item_id, closing_date, closing_quantity
        FROM public.daily_stock_closing
        WHERE closing_date <= p_as_of
        ORDER BY planning_item_id, closing_date DESC
      ) s
    ), '[]'::jsonb),
    'rm', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'item_id', s.raw_material_id,
        'closing_date', s.closing_date,
        'qty', s.closing_quantity))
      FROM (
        SELECT DISTINCT ON (raw_material_id) raw_material_id, closing_date, closing_quantity
        FROM public.consumption_stock_closing
        WHERE closing_date <= p_as_of
        ORDER BY raw_material_id, closing_date DESC
      ) s
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.accounting_inventory_snapshot(DATE) TO anon, authenticated, service_role;
