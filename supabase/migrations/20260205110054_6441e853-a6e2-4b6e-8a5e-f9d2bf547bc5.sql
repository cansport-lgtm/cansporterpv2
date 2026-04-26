-- Create consumption_products table for module-specific products
CREATE TABLE public.consumption_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  unit VARCHAR(20) DEFAULT 'pcs',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.consumption_products ENABLE ROW LEVEL SECURITY;

-- Create permissive policies (app uses custom auth)
CREATE POLICY "Allow all select on consumption_products" ON public.consumption_products FOR SELECT USING (true);
CREATE POLICY "Allow all insert on consumption_products" ON public.consumption_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on consumption_products" ON public.consumption_products FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on consumption_products" ON public.consumption_products FOR DELETE USING (true);

-- Update consumption_bom to reference consumption_products instead of products
-- First drop the existing foreign key if it exists
ALTER TABLE public.consumption_bom DROP CONSTRAINT IF EXISTS consumption_bom_product_id_fkey;

-- Add new foreign key to consumption_products
ALTER TABLE public.consumption_bom 
  ADD CONSTRAINT consumption_bom_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES public.consumption_products(id) ON DELETE CASCADE;