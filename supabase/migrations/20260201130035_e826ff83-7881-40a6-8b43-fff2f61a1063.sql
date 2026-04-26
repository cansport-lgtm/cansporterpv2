-- Create production_planning table for weekly production plans
CREATE TABLE public.production_planning (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_number VARCHAR NOT NULL UNIQUE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  department_id UUID REFERENCES public.production_departments(id),
  status VARCHAR NOT NULL DEFAULT 'draft',
  total_planned_qty NUMERIC DEFAULT 0,
  total_capacity_hrs NUMERIC DEFAULT 0,
  utilization_percent NUMERIC DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  remarks TEXT
);

-- Create production_planning_items for individual plan line items
CREATE TABLE public.production_planning_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.production_planning(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  grade_id UUID REFERENCES public.grades(id),
  planned_date DATE NOT NULL,
  planned_qty_dozens NUMERIC NOT NULL DEFAULT 0,
  stock_in_hand NUMERIC DEFAULT 0,
  expected_demand NUMERIC DEFAULT 0,
  gap_qty NUMERIC DEFAULT 0,
  priority VARCHAR DEFAULT 'medium',
  machine_id UUID REFERENCES public.machines(id),
  capacity_required_hrs NUMERIC DEFAULT 0,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create capacity_master for machine/department capacity settings
CREATE TABLE public.capacity_master (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID REFERENCES public.production_departments(id),
  machine_id UUID REFERENCES public.machines(id),
  product_id UUID REFERENCES public.products(id),
  capacity_per_hour NUMERIC NOT NULL DEFAULT 0,
  capacity_per_day NUMERIC NOT NULL DEFAULT 0,
  working_hours_per_day NUMERIC DEFAULT 8,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  remarks TEXT
);

-- Enable RLS on all tables
ALTER TABLE public.production_planning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_planning_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_master ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow all for production_planning" ON public.production_planning FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for production_planning_items" ON public.production_planning_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for capacity_master" ON public.capacity_master FOR ALL USING (true) WITH CHECK (true);

-- Create function to auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_production_planning_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_production_planning_timestamp
  BEFORE UPDATE ON public.production_planning
  FOR EACH ROW EXECUTE FUNCTION public.update_production_planning_updated_at();

CREATE TRIGGER update_production_planning_items_timestamp
  BEFORE UPDATE ON public.production_planning_items
  FOR EACH ROW EXECUTE FUNCTION public.update_production_planning_updated_at();

CREATE TRIGGER update_capacity_master_timestamp
  BEFORE UPDATE ON public.capacity_master
  FOR EACH ROW EXECUTE FUNCTION public.update_production_planning_updated_at();