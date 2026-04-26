-- Add production_floor column to floor_inventory_stock table
ALTER TABLE public.floor_inventory_stock 
ADD COLUMN production_floor character varying NULL;