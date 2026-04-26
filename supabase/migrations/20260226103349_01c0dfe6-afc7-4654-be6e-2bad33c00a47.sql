
-- Create fixed asset categories master table
CREATE TABLE public.fixed_asset_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fixed_asset_categories ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to view
CREATE POLICY "Anyone can view asset categories" ON public.fixed_asset_categories FOR SELECT USING (true);
CREATE POLICY "Anyone can insert asset categories" ON public.fixed_asset_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update asset categories" ON public.fixed_asset_categories FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete asset categories" ON public.fixed_asset_categories FOR DELETE USING (true);

-- Seed with existing enum values
INSERT INTO public.fixed_asset_categories (code, name) VALUES
  ('OA', 'Office Assets'),
  ('PM', 'Production Machinery'),
  ('MD', 'Molds & Dies'),
  ('MSP', 'Machine Spare Parts');
