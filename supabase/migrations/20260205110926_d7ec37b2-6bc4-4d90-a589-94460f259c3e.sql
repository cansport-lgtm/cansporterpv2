-- Drop the old foreign key constraint
ALTER TABLE public.consumption_production_entry 
DROP CONSTRAINT IF EXISTS consumption_production_entry_product_id_fkey;

-- Add new foreign key to consumption_products
ALTER TABLE public.consumption_production_entry 
ADD CONSTRAINT consumption_production_entry_product_id_fkey 
FOREIGN KEY (product_id) REFERENCES public.consumption_products(id) ON DELETE CASCADE;