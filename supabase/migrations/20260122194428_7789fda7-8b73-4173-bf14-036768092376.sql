-- Create inventory_locations table for warehouse/store locations
CREATE TABLE public.inventory_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  location_type VARCHAR NOT NULL DEFAULT 'warehouse',
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create inventory_stock table for tracking stock across locations
CREATE TABLE public.inventory_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  item_type VARCHAR NOT NULL,
  item_id UUID NOT NULL,
  location_id UUID REFERENCES public.inventory_locations(id),
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit_cost NUMERIC DEFAULT 0,
  min_stock NUMERIC DEFAULT 0,
  max_stock NUMERIC DEFAULT 0,
  reorder_level NUMERIC DEFAULT 0,
  last_movement_date TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(item_type, item_id, location_id)
);

-- Create stock_movements table for tracking all stock in/out
CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  movement_number VARCHAR NOT NULL,
  movement_type VARCHAR NOT NULL,
  movement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  item_type VARCHAR NOT NULL,
  item_id UUID NOT NULL,
  from_location_id UUID REFERENCES public.inventory_locations(id),
  to_location_id UUID REFERENCES public.inventory_locations(id),
  quantity NUMERIC NOT NULL,
  unit_cost NUMERIC DEFAULT 0,
  reference_type VARCHAR,
  reference_id UUID,
  reference_number VARCHAR,
  remarks TEXT,
  status VARCHAR DEFAULT 'completed',
  created_by UUID REFERENCES public.app_users(id),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create inventory_ledger table for detailed transaction history
CREATE TABLE public.inventory_ledger (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ledger_date DATE NOT NULL DEFAULT CURRENT_DATE,
  item_type VARCHAR NOT NULL,
  item_id UUID NOT NULL,
  location_id UUID REFERENCES public.inventory_locations(id),
  movement_id UUID REFERENCES public.stock_movements(id),
  transaction_type VARCHAR NOT NULL,
  quantity_in NUMERIC DEFAULT 0,
  quantity_out NUMERIC DEFAULT 0,
  balance_quantity NUMERIC NOT NULL,
  unit_cost NUMERIC DEFAULT 0,
  value_in NUMERIC DEFAULT 0,
  value_out NUMERIC DEFAULT 0,
  balance_value NUMERIC NOT NULL,
  reference_number VARCHAR,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Add columns to wip_inventory if missing
ALTER TABLE public.wip_inventory ADD COLUMN IF NOT EXISTS process_stage VARCHAR DEFAULT 'production';
ALTER TABLE public.wip_inventory ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'in_process';

-- Enable RLS
ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_ledger ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Full access for inventory_locations" ON public.inventory_locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for inventory_stock" ON public.inventory_stock FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for stock_movements" ON public.stock_movements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for inventory_ledger" ON public.inventory_ledger FOR ALL USING (true) WITH CHECK (true);

-- Create sequence for movement numbers
CREATE SEQUENCE IF NOT EXISTS stock_movement_number_seq START 1;

-- Create function to generate movement number
CREATE OR REPLACE FUNCTION public.generate_movement_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.movement_number := 'SM-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(NEXTVAL('stock_movement_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$function$;

-- Create triggers
CREATE TRIGGER set_movement_number
  BEFORE INSERT ON public.stock_movements
  FOR EACH ROW
  WHEN (NEW.movement_number IS NULL OR NEW.movement_number = '')
  EXECUTE FUNCTION public.generate_movement_number();

CREATE TRIGGER update_inventory_locations_updated_at
  BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_inventory_stock_updated_at
  BEFORE UPDATE ON public.inventory_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_stock_movements_updated_at
  BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();