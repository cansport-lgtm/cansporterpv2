-- Fix: ensure current_qty defaults to 0 when no stock row exists

CREATE OR REPLACE FUNCTION public.floor_inventory_apply_movement(p_movement_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
BEGIN
  SELECT *
  INTO m
  FROM public.floor_inventory_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- idempotency: don't duplicate ledger entries for the same movement
  IF EXISTS (
    SELECT 1
    FROM public.floor_inventory_ledger l
    WHERE l.movement_id = m.id
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  -- Only post completed movements (default is completed)
  IF m.status IS NOT NULL AND m.status <> 'completed' THEN
    RETURN;
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

    stock_row_id := NULL;
    current_qty := 0;
    SELECT s.id, COALESCE(s.quantity, 0)
    INTO stock_row_id, current_qty
    FROM public.floor_inventory_stock s
    WHERE s.item_name = m.item_name
      AND s.location_id = loc
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
    LIMIT 1;

    current_qty := COALESCE(current_qty, 0);
    new_qty := current_qty + qty_in - qty_out;

    IF stock_row_id IS NULL THEN
      INSERT INTO public.floor_inventory_stock (item_name, location_id, quantity, unit)
      VALUES (m.item_name, loc, new_qty, effective_unit);
    ELSE
      UPDATE public.floor_inventory_stock
      SET quantity = new_qty,
          unit = effective_unit
      WHERE id = stock_row_id;
    END IF;

    INSERT INTO public.floor_inventory_ledger (
      ledger_date, item_name, location_id, transaction_type,
      quantity_in, quantity_out, balance_quantity, unit,
      reference_number, remarks, movement_id
    ) VALUES (
      m.movement_date, m.item_name, loc, txn_type,
      qty_in, qty_out, new_qty, effective_unit,
      ref_no, m.remarks, m.id
    );

    -- TRANSFER IN
    loc := m.to_location_id;
    qty_in := COALESCE(m.quantity, 0);
    qty_out := 0;
    txn_type := 'transfer_in';

    stock_row_id := NULL;
    current_qty := 0;
    SELECT s.id, COALESCE(s.quantity, 0)
    INTO stock_row_id, current_qty
    FROM public.floor_inventory_stock s
    WHERE s.item_name = m.item_name
      AND s.location_id = loc
    ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
    LIMIT 1;

    current_qty := COALESCE(current_qty, 0);
    new_qty := current_qty + qty_in - qty_out;

    IF stock_row_id IS NULL THEN
      INSERT INTO public.floor_inventory_stock (item_name, location_id, quantity, unit)
      VALUES (m.item_name, loc, new_qty, effective_unit);
    ELSE
      UPDATE public.floor_inventory_stock
      SET quantity = new_qty,
          unit = effective_unit
      WHERE id = stock_row_id;
    END IF;

    INSERT INTO public.floor_inventory_ledger (
      ledger_date, item_name, location_id, transaction_type,
      quantity_in, quantity_out, balance_quantity, unit,
      reference_number, remarks, movement_id
    ) VALUES (
      m.movement_date, m.item_name, loc, txn_type,
      qty_in, qty_out, new_qty, effective_unit,
      ref_no, m.remarks, m.id
    );

    RETURN;
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

  ELSE
    -- adjustment
    IF m.from_location_id IS NOT NULL AND m.to_location_id IS NULL THEN
      loc := m.from_location_id;
      qty_out := COALESCE(m.quantity, 0);
    ELSE
      loc := m.to_location_id;
      qty_in := COALESCE(m.quantity, 0);
    END IF;

    IF loc IS NULL THEN
      RAISE EXCEPTION 'Adjustment movement requires a location';
    END IF;

    txn_type := 'adjustment';
  END IF;

  stock_row_id := NULL;
  current_qty := 0;
  SELECT s.id, COALESCE(s.quantity, 0)
  INTO stock_row_id, current_qty
  FROM public.floor_inventory_stock s
  WHERE s.item_name = m.item_name
    AND s.location_id = loc
  ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
  LIMIT 1;

  current_qty := COALESCE(current_qty, 0);
  new_qty := current_qty + qty_in - qty_out;

  IF stock_row_id IS NULL THEN
    INSERT INTO public.floor_inventory_stock (item_name, location_id, quantity, unit)
    VALUES (m.item_name, loc, new_qty, effective_unit);
  ELSE
    UPDATE public.floor_inventory_stock
    SET quantity = new_qty,
        unit = effective_unit
    WHERE id = stock_row_id;
  END IF;

  INSERT INTO public.floor_inventory_ledger (
    ledger_date, item_name, location_id, transaction_type,
    quantity_in, quantity_out, balance_quantity, unit,
    reference_number, remarks, movement_id
  ) VALUES (
    m.movement_date, m.item_name, loc, txn_type,
    qty_in, qty_out, new_qty, effective_unit,
    ref_no, m.remarks, m.id
  );
END;
$$;

-- Re-run backfill now that function is fixed
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (SELECT id FROM public.floor_inventory_movements ORDER BY created_at ASC) LOOP
    PERFORM public.floor_inventory_apply_movement(r.id);
  END LOOP;
END;
$$;