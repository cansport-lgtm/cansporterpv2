-- Add category column to floor_inventory_stock
ALTER TABLE public.floor_inventory_stock 
ADD COLUMN category character varying DEFAULT 'raw_material';

-- Add comment for documentation
COMMENT ON COLUMN public.floor_inventory_stock.category IS 'Stock category: raw_material, inter_step, finished';