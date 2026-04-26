-- Create Floor Inventory Locations table
CREATE TABLE public.floor_inventory_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL,
  code VARCHAR UNIQUE,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create Floor Inventory Stock table
CREATE TABLE public.floor_inventory_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name VARCHAR NOT NULL,
  item_code VARCHAR,
  location_id UUID REFERENCES public.floor_inventory_locations(id),
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit VARCHAR DEFAULT 'pcs',
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create Floor Inventory Movements table (for tracking stock in/out)
CREATE TABLE public.floor_inventory_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  movement_number VARCHAR UNIQUE,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  movement_type VARCHAR NOT NULL CHECK (movement_type IN ('receipt', 'issue', 'transfer', 'adjustment')),
  item_name VARCHAR NOT NULL,
  from_location_id UUID REFERENCES public.floor_inventory_locations(id),
  to_location_id UUID REFERENCES public.floor_inventory_locations(id),
  quantity NUMERIC NOT NULL,
  unit VARCHAR DEFAULT 'pcs',
  reference_type VARCHAR CHECK (reference_type IN ('internal', 'adjustment', 'manual')),
  reference_number VARCHAR,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  status VARCHAR DEFAULT 'completed',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create Floor Inventory Ledger table
CREATE TABLE public.floor_inventory_ledger (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ledger_date DATE NOT NULL DEFAULT CURRENT_DATE,
  item_name VARCHAR NOT NULL,
  location_id UUID REFERENCES public.floor_inventory_locations(id),
  movement_id UUID REFERENCES public.floor_inventory_movements(id),
  transaction_type VARCHAR NOT NULL,
  quantity_in NUMERIC DEFAULT 0,
  quantity_out NUMERIC DEFAULT 0,
  balance_quantity NUMERIC NOT NULL,
  unit VARCHAR DEFAULT 'pcs',
  reference_number VARCHAR,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create sequence for floor inventory movement numbers
CREATE SEQUENCE IF NOT EXISTS floor_inventory_movement_seq START 1;

-- Create function to generate floor inventory movement number
CREATE OR REPLACE FUNCTION public.generate_floor_movement_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.movement_number IS NULL THEN
    NEW.movement_number := 'FM-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(nextval('floor_inventory_movement_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-generating movement numbers
CREATE TRIGGER set_floor_movement_number
  BEFORE INSERT ON public.floor_inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_floor_movement_number();

-- Enable RLS
ALTER TABLE public.floor_inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_inventory_ledger ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Full access for floor_inventory_locations" ON public.floor_inventory_locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for floor_inventory_stock" ON public.floor_inventory_stock FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for floor_inventory_movements" ON public.floor_inventory_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for floor_inventory_ledger" ON public.floor_inventory_ledger FOR ALL USING (true) WITH CHECK (true);

-- Create updated_at triggers
CREATE TRIGGER update_floor_inventory_locations_updated_at
  BEFORE UPDATE ON public.floor_inventory_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_floor_inventory_stock_updated_at
  BEFORE UPDATE ON public.floor_inventory_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_floor_inventory_movements_updated_at
  BEFORE UPDATE ON public.floor_inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Insert some default floor locations
INSERT INTO public.floor_inventory_locations (name, code, description) VALUES
  ('Production Floor A', 'PFA', 'Main production floor section A'),
  ('Production Floor B', 'PFB', 'Main production floor section B'),
  ('Assembly Line 1', 'AL1', 'Primary assembly line'),
  ('Assembly Line 2', 'AL2', 'Secondary assembly line'),
  ('Packing Area', 'PKA', 'Final packing station');