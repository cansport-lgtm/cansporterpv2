-- Create trigger to automatically apply movements to stock and ledger
CREATE OR REPLACE FUNCTION public.trigger_floor_inventory_apply_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Call the apply movement function for the newly inserted movement
  PERFORM public.floor_inventory_apply_movement(NEW.id);
  RETURN NEW;
END;
$$;

-- Create the trigger on floor_inventory_movements table
DROP TRIGGER IF EXISTS trg_floor_inventory_apply_movement ON public.floor_inventory_movements;

CREATE TRIGGER trg_floor_inventory_apply_movement
AFTER INSERT ON public.floor_inventory_movements
FOR EACH ROW
EXECUTE FUNCTION public.trigger_floor_inventory_apply_movement();