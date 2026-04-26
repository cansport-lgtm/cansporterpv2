-- Maintenance Module Tables

-- 1. Maintenance Types (Preventive, Corrective, Breakdown, etc.)
CREATE TABLE public.maintenance_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. Spare Parts Master
CREATE TABLE public.spare_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  unit_of_measure VARCHAR(50),
  minimum_stock INTEGER DEFAULT 0,
  current_stock INTEGER DEFAULT 0,
  unit_cost DECIMAL(12,2),
  location VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. Maintenance Schedules (Preventive Maintenance)
CREATE TABLE public.maintenance_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_number VARCHAR(50) NOT NULL UNIQUE,
  machine_id UUID REFERENCES public.machines(id),
  maintenance_type_id UUID REFERENCES public.maintenance_types(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  frequency_days INTEGER NOT NULL,
  last_performed_date DATE,
  next_due_date DATE NOT NULL,
  priority public.priority_level DEFAULT 'medium',
  estimated_duration_hours DECIMAL(5,2),
  instructions TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. Work Orders
CREATE TABLE public.maintenance_work_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_number VARCHAR(50) NOT NULL UNIQUE,
  machine_id UUID REFERENCES public.machines(id),
  maintenance_type_id UUID REFERENCES public.maintenance_types(id),
  schedule_id UUID REFERENCES public.maintenance_schedules(id),
  downtime_reason_id UUID REFERENCES public.downtime_reasons(id),
  title VARCHAR(200) NOT NULL,
  description TEXT,
  priority public.priority_level DEFAULT 'medium',
  status public.record_status DEFAULT 'draft',
  requested_date DATE NOT NULL DEFAULT CURRENT_DATE,
  scheduled_date DATE,
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),
  root_cause TEXT,
  action_taken TEXT,
  remarks TEXT,
  requested_by UUID REFERENCES public.app_users(id),
  assigned_to UUID REFERENCES public.app_users(id),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 5. Work Order Spare Parts Usage
CREATE TABLE public.work_order_spare_parts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_order_id UUID NOT NULL REFERENCES public.maintenance_work_orders(id) ON DELETE CASCADE,
  spare_part_id UUID NOT NULL REFERENCES public.spare_parts(id),
  quantity_used INTEGER NOT NULL DEFAULT 1,
  unit_cost DECIMAL(12,2),
  total_cost DECIMAL(12,2),
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 6. Breakdown Log
CREATE TABLE public.breakdown_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  breakdown_number VARCHAR(50) NOT NULL UNIQUE,
  machine_id UUID NOT NULL REFERENCES public.machines(id),
  downtime_reason_id UUID REFERENCES public.downtime_reasons(id),
  work_order_id UUID REFERENCES public.maintenance_work_orders(id),
  breakdown_start TIMESTAMP WITH TIME ZONE NOT NULL,
  breakdown_end TIMESTAMP WITH TIME ZONE,
  downtime_minutes INTEGER,
  description TEXT NOT NULL,
  immediate_action TEXT,
  root_cause TEXT,
  priority public.priority_level DEFAULT 'high',
  status public.record_status DEFAULT 'in_progress',
  reported_by UUID REFERENCES public.app_users(id),
  resolved_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 7. Development Tasks (New feature tracking)
CREATE TABLE public.development_tasks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_number VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  module VARCHAR(100),
  priority public.priority_level DEFAULT 'medium',
  status public.record_status DEFAULT 'draft',
  estimated_hours DECIMAL(5,2),
  actual_hours DECIMAL(5,2),
  target_date DATE,
  completed_date DATE,
  assigned_to UUID REFERENCES public.app_users(id),
  created_by UUID REFERENCES public.app_users(id),
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.maintenance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.breakdown_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies (permissive for authenticated users as per existing pattern)
CREATE POLICY "Allow all for authenticated" ON public.maintenance_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.spare_parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.maintenance_schedules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.maintenance_work_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.work_order_spare_parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.breakdown_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.development_tasks FOR ALL USING (true) WITH CHECK (true);

-- Insert default maintenance types
INSERT INTO public.maintenance_types (code, name, description) VALUES
  ('PM', 'Preventive Maintenance', 'Scheduled maintenance to prevent breakdowns'),
  ('CM', 'Corrective Maintenance', 'Repairs after identifying issues'),
  ('BM', 'Breakdown Maintenance', 'Emergency repairs after equipment failure'),
  ('PDM', 'Predictive Maintenance', 'Maintenance based on condition monitoring');

-- Functions to generate auto-numbers
CREATE OR REPLACE FUNCTION public.generate_work_order_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
  v_number TEXT;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM maintenance_work_orders 
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  v_number := 'WO-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_breakdown_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
  v_number TEXT;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM breakdown_logs 
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  v_number := 'BD-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_schedule_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_number TEXT;
BEGIN
  SELECT COUNT(*) + 1 INTO v_count FROM maintenance_schedules;
  v_number := 'SCH-' || LPAD(v_count::TEXT, 5, '0');
  RETURN v_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_dev_task_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
  v_number TEXT;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM development_tasks 
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  v_number := 'DEV-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN v_number;
END;
$$;

-- Trigger to update spare parts stock when used in work orders
CREATE OR REPLACE FUNCTION public.update_spare_part_stock()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE spare_parts SET current_stock = current_stock - NEW.quantity_used WHERE id = NEW.spare_part_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE spare_parts SET current_stock = current_stock + OLD.quantity_used WHERE id = OLD.spare_part_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE spare_parts SET current_stock = current_stock + OLD.quantity_used - NEW.quantity_used WHERE id = NEW.spare_part_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_spare_part_stock
AFTER INSERT OR UPDATE OR DELETE ON public.work_order_spare_parts
FOR EACH ROW EXECUTE FUNCTION public.update_spare_part_stock();