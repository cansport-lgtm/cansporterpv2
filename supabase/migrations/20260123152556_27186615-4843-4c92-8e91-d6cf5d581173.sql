-- Drop the old constraint and add updated one with 'production' value
ALTER TABLE floor_inventory_movements DROP CONSTRAINT floor_inventory_movements_reference_type_check;

ALTER TABLE floor_inventory_movements ADD CONSTRAINT floor_inventory_movements_reference_type_check 
CHECK (reference_type IN ('internal', 'adjustment', 'manual', 'production'));