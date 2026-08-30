-- Fix floor_inventory_apply_movement to handle backdated entries properly
-- When a backdated movement is added, we need to recalculate all balances after that date

CREATE OR REPLACE FUNCTION public.floor_inventory_apply_movement()
RETURNS TRIGGER AS $$
DECLARE
  m RECORD;
  loc uuid;
  stock_row_id uuid;
  current_qty numeric := 0;
  new_qty numeric;
  qty_in numeric;
  qty_out numeric;
  txn_type text;
  effective_unit text;
  ref_no text;
  last_balance numeric := 0;
BEGIN
  m := NEW;

  -- Only post completed movements (default is completed)
  IF m.status IS NOT NULL AND m.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  effective_unit := COALESCE(m.unit, 'pcs');
  ref_no := COALESCE(m.movement_number, m.reference_number);

  -- Treat as transfer if both locations are present and different
  IF m.from_location_id IS NOT NULL
     AND m.to_location_id IS NOT NULL
     AND m.from_location_id <> m.to_location_id THEN

    -- TRANSFER OUT
    loc := m.from_location_id;
    qty_in := 0;
    qty_out := COALESCE(m.quantity, 0);
    txn_type := 'transfer_out';

    -- Get last balance from ledger for this item+location BEFORE OR ON movement_date
    SELECT COALESCE(l.balance_quantity, 0)
    INTO last_balance
    FROM public.floor_inventory_ledger l
    WHERE l.item_name = m.item_name 
      AND l.location_id = loc
      AND (l.ledger_date < m.movement_date OR (l.ledger_date = m.movement_date AND l.created_at < NOW()))
    ORDER BY l.ledger_date DESC, l.created_at DESC
    LIMIT 1;

    last_balance := COALESCE(last_balance, 0);
    new_qty := last_balance + qty_in - qty_out;

    INSERT INTO public.floor_inventory_ledger (
      ledger_date, item_name, location_id, transaction_type,
      quantity_in, quantity_out, balance_quantity, unit,
      reference_number, remarks, movement_id
    ) VALUES (
      m.movement_date, m.item_name, loc, txn_type,
      qty_in, qty_out, new_qty, effective_unit,
      ref_no, m.remarks, m.id
    );

    -- Recalculate balances for entries AFTER this movement_date
    PERFORM public.floor_inventory_recalc_ledger_balances(m.item_name, loc, m.movement_date);

    -- TRANSFER IN
    loc := m.to_location_id;
    qty_in := COALESCE(m.quantity, 0);
    qty_out := 0;
    txn_type := 'transfer_in';

    -- Get last balance from ledger for this item+location BEFORE OR ON movement_date
    SELECT COALESCE(l.balance_quantity, 0)
    INTO last_balance
    FROM public.floor_inventory_ledger l
    WHERE l.item_name = m.item_name 
      AND l.location_id = loc
      AND (l.ledger_date < m.movement_date OR (l.ledger_date = m.movement_date AND l.created_at < NOW()))
    ORDER BY l.ledger_date DESC, l.created_at DESC
    LIMIT 1;

    last_balance := COALESCE(last_balance, 0);
    new_qty := last_balance + qty_in - qty_out;

    INSERT INTO public.floor_inventory_ledger (
      ledger_date, item_name, location_id, transaction_type,
      quantity_in, quantity_out, balance_quantity, unit,
      reference_number, remarks, movement_id
    ) VALUES (
      m.movement_date, m.item_name, loc, txn_type,
      qty_in, qty_out, new_qty, effective_unit,
      ref_no, m.remarks, m.id
    );

    -- Recalculate balances for entries AFTER this movement_date
    PERFORM public.floor_inventory_recalc_ledger_balances(m.item_name, loc, m.movement_date);

    -- Update stock tables
    PERFORM public.floor_inventory_update_stock_from_ledger(m.item_name, m.from_location_id);
    PERFORM public.floor_inventory_update_stock_from_ledger(m.item_name, m.to_location_id);

    RETURN NEW;
  END IF;

  -- Non-transfer movement types
  qty_in := 0;
  qty_out := 0;

  IF m.movement_type = 'receipt' THEN
    loc := COALESCE(m.to_location_id, m.from_location_id);
    IF loc IS NULL THEN
      RAISE EXCEPTION 'Receipt movement requires a location';
    END IF;
    qty_in := COALESCE(m.quantity, 0);
    txn_type := 'receipt';

  ELSIF m.movement_type = 'issue' THEN
    loc := COALESCE(m.from_location_id, m.to_location_id);
    IF loc IS NULL THEN
      RAISE EXCEPTION 'Issue movement requires a location';
    END IF;
    qty_out := COALESCE(m.quantity, 0);
    txn_type := 'issue';

  ELSIF m.movement_type = 'adjustment' THEN
    loc := COALESCE(m.to_location_id, m.from_location_id);
    IF loc IS NULL THEN
      RAISE EXCEPTION 'Adjustment movement requires a location';
    END IF;
    IF m.quantity >= 0 THEN
      qty_in := COALESCE(m.quantity, 0);
    ELSE
      qty_out := ABS(COALESCE(m.quantity, 0));
    END IF;
    txn_type := 'adjustment';

  ELSE
    RAISE EXCEPTION 'Unknown movement_type: %', m.movement_type;
  END IF;

  -- Get last balance from ledger for this item+location BEFORE this movement
  SELECT COALESCE(l.balance_quantity, 0)
  INTO last_balance
  FROM public.floor_inventory_ledger l
  WHERE l.item_name = m.item_name 
    AND l.location_id = loc
    AND (l.ledger_date < m.movement_date OR (l.ledger_date = m.movement_date AND l.created_at < NOW()))
  ORDER BY l.ledger_date DESC, l.created_at DESC
  LIMIT 1;

  last_balance := COALESCE(last_balance, 0);
  new_qty := last_balance + qty_in - qty_out;

  INSERT INTO public.floor_inventory_ledger (
    ledger_date, item_name, location_id, transaction_type,
    quantity_in, quantity_out, balance_quantity, unit,
    reference_number, remarks, movement_id
  ) VALUES (
    m.movement_date, m.item_name, loc, txn_type,
    qty_in, qty_out, new_qty, effective_unit,
    ref_no, m.remarks, m.id
  );

  -- Recalculate balances for entries AFTER this movement_date
  PERFORM public.floor_inventory_recalc_ledger_balances(m.item_name, loc, m.movement_date);

  -- Update stock from latest ledger balance
  PERFORM public.floor_inventory_update_stock_from_ledger(m.item_name, loc);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Helper function to recalculate ledger balances after a given date
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
  -- Get the balance just before or on p_from_date (the latest one before recalculation starts)
  SELECT COALESCE(l.balance_quantity, 0)
  INTO running_balance
  FROM public.floor_inventory_ledger l
  WHERE l.item_name = p_item_name 
    AND l.location_id = p_location_id
    AND l.ledger_date <= p_from_date
  ORDER BY l.ledger_date DESC, l.created_at DESC
  LIMIT 1;

  running_balance := COALESCE(running_balance, 0);

  -- Now update all entries AFTER the first one on p_from_date in chronological order
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

-- Helper function to update stock from latest ledger entry
CREATE OR REPLACE FUNCTION public.floor_inventory_update_stock_from_ledger(
  p_item_name text,
  p_location_id uuid
)
RETURNS void AS $$
DECLARE
  latest_balance numeric := 0;
  latest_unit text := 'pcs';
  stock_row_id uuid;
BEGIN
  -- Get the latest balance from ledger
  SELECT l.balance_quantity, l.unit
  INTO latest_balance, latest_unit
  FROM public.floor_inventory_ledger l
  WHERE l.item_name = p_item_name 
    AND l.location_id = p_location_id
  ORDER BY l.ledger_date DESC, l.created_at DESC
  LIMIT 1;

  -- No ledger rows means there is no balance to sync — and on a fresh replay
  -- (a preview branch) the hardcoded location below may not even exist, so an
  -- insert here would break the FK. Nothing to do either way.
  IF NOT FOUND THEN
    RETURN;
  END IF;

  latest_balance := COALESCE(latest_balance, 0);
  latest_unit := COALESCE(latest_unit, 'pcs');

  -- Update or insert stock
  SELECT s.id INTO stock_row_id
  FROM public.floor_inventory_stock s
  WHERE s.item_name = p_item_name AND s.location_id = p_location_id
  LIMIT 1;

  IF stock_row_id IS NULL THEN
    INSERT INTO public.floor_inventory_stock (item_name, location_id, quantity, unit)
    VALUES (p_item_name, p_location_id, latest_balance, latest_unit);
  ELSE
    UPDATE public.floor_inventory_stock
    SET quantity = latest_balance, unit = latest_unit, updated_at = NOW()
    WHERE id = stock_row_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Drop old trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_floor_inventory_apply_movement ON public.floor_inventory_movements;

CREATE TRIGGER trg_floor_inventory_apply_movement
AFTER INSERT ON public.floor_inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.floor_inventory_apply_movement();

-- Now fix existing data for JORR BAG LOCAL
SELECT public.floor_inventory_recalc_ledger_balances('JORR BAG LOCAL', '799e86bd-fd36-4954-9765-85d21337f4d5', '2026-01-01');
SELECT public.floor_inventory_update_stock_from_ledger('JORR BAG LOCAL', '799e86bd-fd36-4954-9765-85d21337f4d5');

-- Also fix PRESS SHEET LOCAL
SELECT public.floor_inventory_recalc_ledger_balances('PRESS SHEET LOCAL', '799e86bd-fd36-4954-9765-85d21337f4d5', '2026-01-01');
SELECT public.floor_inventory_update_stock_from_ledger('PRESS SHEET LOCAL', '799e86bd-fd36-4954-9765-85d21337f4d5');
SELECT public.floor_inventory_recalc_ledger_balances('PRESS SHEET LOCAL', 'f56fc5b6-1a32-4dca-ab65-dd16905fe392', '2026-01-01');
SELECT public.floor_inventory_update_stock_from_ledger('PRESS SHEET LOCAL', 'f56fc5b6-1a32-4dca-ab65-dd16905fe392');