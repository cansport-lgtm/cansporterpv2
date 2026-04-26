
-- Fix the recalculation logic to properly handle the starting balance
CREATE OR REPLACE FUNCTION public.floor_inventory_recalc_ledger_balances(
  p_item_name text,
  p_location_id uuid,
  p_from_date date
)
RETURNS void AS $$
DECLARE
  running_balance numeric := 0;
  rec RECORD;
BEGIN
  -- Get the balance just BEFORE p_from_date (strictly less than, not on the date)
  SELECT COALESCE(l.balance_quantity, 0)
  INTO running_balance
  FROM public.floor_inventory_ledger l
  WHERE l.item_name = p_item_name 
    AND l.location_id = p_location_id
    AND l.ledger_date < p_from_date
  ORDER BY l.ledger_date DESC, l.created_at DESC
  LIMIT 1;

  running_balance := COALESCE(running_balance, 0);

  -- Now update all entries starting FROM p_from_date in chronological order
  FOR rec IN 
    SELECT l.id, l.quantity_in, l.quantity_out, l.ledger_date, l.created_at
    FROM public.floor_inventory_ledger l
    WHERE l.item_name = p_item_name 
      AND l.location_id = p_location_id
      AND l.ledger_date >= p_from_date
    ORDER BY l.ledger_date ASC, l.created_at ASC
  LOOP
    running_balance := running_balance + COALESCE(rec.quantity_in, 0) - COALESCE(rec.quantity_out, 0);
    
    UPDATE public.floor_inventory_ledger
    SET balance_quantity = running_balance
    WHERE id = rec.id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Now fix the existing data for JORR BAG LOCAL
SELECT public.floor_inventory_recalc_ledger_balances('JORR BAG LOCAL', '799e86bd-fd36-4954-9765-85d21337f4d5', '2026-01-20');
SELECT public.floor_inventory_update_stock_from_ledger('JORR BAG LOCAL', '799e86bd-fd36-4954-9765-85d21337f4d5');
