-- Create enum for asset categories
CREATE TYPE public.asset_category AS ENUM ('office_assets', 'production_machinery', 'molds_dies', 'machine_spare_parts');

-- Create enum for asset status
CREATE TYPE public.asset_status AS ENUM ('active', 'under_maintenance', 'disposed', 'written_off', 'sold');

-- Create fixed_assets table
CREATE TABLE public.fixed_assets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_code VARCHAR NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  description TEXT,
  category asset_category NOT NULL,
  
  -- Purchase/acquisition details
  purchase_date DATE,
  purchase_price NUMERIC DEFAULT 0,
  supplier_name VARCHAR,
  invoice_number VARCHAR,
  warranty_expiry DATE,
  
  -- Current valuation
  current_value NUMERIC DEFAULT 0,
  last_valuation_date DATE,
  
  -- Location tracking
  department_id UUID REFERENCES public.production_departments(id),
  location_description TEXT,
  
  -- Status and lifecycle
  status asset_status NOT NULL DEFAULT 'active',
  disposal_date DATE,
  disposal_reason TEXT,
  disposal_value NUMERIC,
  
  -- Specifications (for machinery/molds)
  specifications JSONB,
  serial_number VARCHAR,
  manufacturer VARCHAR,
  model VARCHAR,
  
  -- Audit fields
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create asset valuations table for tracking value changes over time
CREATE TABLE public.asset_valuations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  asset_id UUID NOT NULL REFERENCES public.fixed_assets(id) ON DELETE CASCADE,
  valuation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  previous_value NUMERIC DEFAULT 0,
  new_value NUMERIC NOT NULL,
  reason TEXT,
  valued_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_valuations ENABLE ROW LEVEL SECURITY;

-- RLS policies for fixed_assets
CREATE POLICY "Full access for fixed_assets"
ON public.fixed_assets
FOR ALL
USING (true)
WITH CHECK (true);

-- RLS policies for asset_valuations
CREATE POLICY "Full access for asset_valuations"
ON public.asset_valuations
FOR ALL
USING (true)
WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_fixed_assets_category ON public.fixed_assets(category);
CREATE INDEX idx_fixed_assets_status ON public.fixed_assets(status);
CREATE INDEX idx_fixed_assets_department ON public.fixed_assets(department_id);
CREATE INDEX idx_asset_valuations_asset ON public.asset_valuations(asset_id);

-- Update timestamp trigger for fixed_assets
CREATE TRIGGER update_fixed_assets_updated_at
  BEFORE UPDATE ON public.fixed_assets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();