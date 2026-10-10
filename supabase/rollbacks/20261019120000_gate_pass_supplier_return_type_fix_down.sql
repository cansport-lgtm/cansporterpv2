-- Rollback for 20261019120000_gate_pass_supplier_return_type_fix.sql.
-- Restores the original definition (supplier-return passes fail to save again).

CREATE OR REPLACE FUNCTION public.gate_pass_build_supplier_return(p_id uuid, p_return_id uuid)
RETURNS TABLE (party_name text, party_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_other text;
  v_n integer;
BEGIN
  SELECT pr.*, s.name AS supplier_name INTO r
    FROM public.purchase_returns pr
    LEFT JOIN public.suppliers s ON s.id = pr.supplier_id
   WHERE pr.id = p_return_id
     FOR UPDATE OF pr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select the purchase return this material is going back on.';
  END IF;
  IF r.status = 'cancelled' THEN
    RAISE EXCEPTION 'Purchase return % is cancelled.', COALESCE(r.return_number, '');
  END IF;
  SELECT g.pass_number INTO v_other
    FROM public.gate_passes g
   WHERE g.purchase_return_id = p_return_id AND g.id <> p_id
     AND g.status NOT IN ('cancelled','rejected')
   LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Purchase return % is already on gate pass %.', COALESCE(r.return_number, ''), v_other;
  END IF;

  DELETE FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  INSERT INTO public.gate_pass_items
    (gate_pass_id, line_no, purchase_return_item_id, description, uom, quantity, count_basis)
  SELECT p_id, row_number() OVER (ORDER BY ri.line_order, ri.id), ri.id,
         COALESCE(NULLIF(it.code || ' · ' || it.name, ''), NULLIF(ri.description, ''), 'Item'),
         COALESCE(NULLIF(u.symbol, ''), 'unit'), ri.quantity, 'quantity'
    FROM public.purchase_return_items ri
    LEFT JOIN public.items it ON it.id = ri.item_id
    LEFT JOIN public.units_of_measure u ON u.id = it.uom_id
   WHERE ri.return_id = p_return_id AND ri.quantity > 0;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'Purchase return % has no items.', COALESCE(r.return_number, '');
  END IF;

  RETURN QUERY SELECT COALESCE(r.supplier_name, 'Supplier'), r.supplier_id;
END;
$$;
