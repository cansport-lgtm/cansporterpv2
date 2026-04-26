-- Create BOM (Bill of Materials) table for floor inventory production recipes
CREATE TABLE public.floor_inventory_bom (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  output_item_name varchar NOT NULL,
  output_quantity numeric NOT NULL DEFAULT 1,
  output_unit varchar DEFAULT 'pcs',
  input_item_name varchar NOT NULL,
  input_quantity numeric NOT NULL DEFAULT 1,
  input_unit varchar DEFAULT 'pcs',
  is_active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.floor_inventory_bom ENABLE ROW LEVEL SECURITY;

-- Create policy for full access
CREATE POLICY "Full access for floor_inventory_bom"
ON public.floor_inventory_bom
FOR ALL
USING (true)
WITH CHECK (true);

-- Add updated_at trigger
CREATE TRIGGER update_floor_inventory_bom_updated_at
BEFORE UPDATE ON public.floor_inventory_bom
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create production function to execute a recipe
CREATE OR REPLACE FUNCTION public.floor_inventory_execute_production(
  p_bom_id uuid,
  p_multiplier numeric,
  p_from_location_id uuid,
  p_to_location_id uuid,
  p_remarks text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  bom RECORD;
  v_input_qty numeric;
  v_output_qty numeric;
  v_issue_movement_id uuid;
  v_receipt_movement_id uuid;
BEGIN
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
    CURRENT_DATE,
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
    CURRENT_DATE,
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
$$;