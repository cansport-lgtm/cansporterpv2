-- Production Entries table for daily production logging
CREATE TABLE public.production_entries (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift VARCHAR(20) NOT NULL DEFAULT 'Day',
    department_id UUID NOT NULL REFERENCES public.production_departments(id),
    machine_id UUID REFERENCES public.machines(id),
    grade_id UUID NOT NULL REFERENCES public.grades(id),
    quantity_produced NUMERIC NOT NULL DEFAULT 0,
    quantity_ok NUMERIC NOT NULL DEFAULT 0,
    quantity_rejected NUMERIC NOT NULL DEFAULT 0,
    uom_id UUID REFERENCES public.units_of_measure(id),
    operator_id UUID REFERENCES public.employees(id),
    supervisor_id UUID REFERENCES public.app_users(id),
    remarks TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'Draft',
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Production Rejections table for tracking rejection details
CREATE TABLE public.production_rejections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    production_entry_id UUID NOT NULL REFERENCES public.production_entries(id) ON DELETE CASCADE,
    defect_reason_id UUID NOT NULL REFERENCES public.defect_reasons(id),
    quantity NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- WIP (Work In Progress) tracking table
CREATE TABLE public.wip_inventory (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    department_id UUID NOT NULL REFERENCES public.production_departments(id),
    grade_id UUID NOT NULL REFERENCES public.grades(id),
    opening_qty NUMERIC NOT NULL DEFAULT 0,
    received_qty NUMERIC NOT NULL DEFAULT 0,
    produced_qty NUMERIC NOT NULL DEFAULT 0,
    transferred_qty NUMERIC NOT NULL DEFAULT 0,
    closing_qty NUMERIC NOT NULL DEFAULT 0,
    uom_id UUID REFERENCES public.units_of_measure(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(entry_date, department_id, grade_id)
);

-- Enable RLS
ALTER TABLE public.production_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wip_inventory ENABLE ROW LEVEL SECURITY;

-- RLS Policies for production_entries
CREATE POLICY "Full access for production_entries" 
ON public.production_entries 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- RLS Policies for production_rejections
CREATE POLICY "Full access for production_rejections" 
ON public.production_rejections 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- RLS Policies for wip_inventory
CREATE POLICY "Full access for wip_inventory" 
ON public.wip_inventory 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Trigger for updated_at on production_entries
CREATE TRIGGER update_production_entries_updated_at
BEFORE UPDATE ON public.production_entries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for updated_at on wip_inventory
CREATE TRIGGER update_wip_inventory_updated_at
BEFORE UPDATE ON public.wip_inventory
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_production_entries_date ON public.production_entries(entry_date);
CREATE INDEX idx_production_entries_department ON public.production_entries(department_id);
CREATE INDEX idx_production_entries_grade ON public.production_entries(grade_id);
CREATE INDEX idx_production_entries_status ON public.production_entries(status);
CREATE INDEX idx_wip_inventory_date ON public.wip_inventory(entry_date);
CREATE INDEX idx_wip_inventory_department ON public.wip_inventory(department_id);