-- Update the floor_inventory_execute_production function to accept a date parameter
CREATE OR REPLACE FUNCTION public.floor_inventory_execute_production(
  p_bom_id uuid, 
  p_multiplier numeric, 
  p_from_location_id uuid, 
  p_to_location_id uuid, 
  p_remarks text DEFAULT NULL::text,
  p_production_date date DEFAULT NULL::date
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  bom RECORD;
  v_input_qty numeric;
  v_output_qty numeric;
  v_issue_movement_id uuid;
  v_receipt_movement_id uuid;
  v_date date;
BEGIN
  -- Use provided date or default to current date
  v_date := COALESCE(p_production_date, CURRENT_DATE);
  
  -- Get BOM details
  SELECT * INTO bom FROM public.floor_inventory_bom WHERE id = p_bom_id AND is_active = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BOM recipe not found or inactive';
  END IF;
  
  -- Calculate quantities based on multiplier
  v_input_qty := bom.input_quantity * p_multiplier;
  v_output_qty := bom.output_quantity * p_multiplier;
  
  -- Create issue movement for input item (consumption)
  INSERT INTO public.floor_inventory_movements (
    movement_date,
    movement_type,
    item_name,
    from_location_id,
    quantity,
    unit,
    reference_type,
    remarks,
    status
  ) VALUES (
    v_date,
    'issue',
    bom.input_item_name,
    p_from_location_id,
    v_input_qty,
    bom.input_unit,
    'production',
    COALESCE(p_remarks, 'Production: ' || bom.input_item_name || ' -> ' || bom.output_item_name),
    'completed'
  ) RETURNING id INTO v_issue_movement_id;
  
  -- Create receipt movement for output item (production)
  INSERT INTO public.floor_inventory_movements (
    movement_date,
    movement_type,
    item_name,
    to_location_id,
    quantity,
    unit,
    reference_type,
    remarks,
    status
  ) VALUES (
    v_date,
    'receipt',
    bom.output_item_name,
    p_to_location_id,
    v_output_qty,
    bom.output_unit,
    'production',
    COALESCE(p_remarks, 'Production: ' || bom.input_item_name || ' -> ' || bom.output_item_name),
    'completed'
  ) RETURNING id INTO v_receipt_movement_id;
  
  RETURN v_receipt_movement_id;
END;
$function$;