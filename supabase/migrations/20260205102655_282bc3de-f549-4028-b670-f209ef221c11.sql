-- Create Material Consumption Tracking Module Tables

-- Raw Materials Master
CREATE TABLE public.consumption_raw_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    unit VARCHAR(50) DEFAULT 'kg',
    category VARCHAR(100),
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Consumption BOM (Bill of Materials) - defines standard consumption per product
CREATE TABLE public.consumption_bom (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    raw_material_id UUID REFERENCES public.consumption_raw_materials(id) ON DELETE CASCADE NOT NULL,
    standard_quantity NUMERIC(12, 4) NOT NULL DEFAULT 0, -- qty per unit of product
    unit VARCHAR(50) DEFAULT 'kg',
    is_active BOOLEAN DEFAULT true,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(product_id, raw_material_id)
);

-- Daily Stock Closing for Raw Materials
CREATE TABLE public.consumption_stock_closing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closing_date DATE NOT NULL,
    raw_material_id UUID REFERENCES public.consumption_raw_materials(id) ON DELETE CASCADE NOT NULL,
    opening_quantity NUMERIC(12, 4) DEFAULT 0,
    receipt_quantity NUMERIC(12, 4) DEFAULT 0, -- additions during the day
    closing_quantity NUMERIC(12, 4) NOT NULL DEFAULT 0,
    actual_consumption NUMERIC(12, 4) GENERATED ALWAYS AS (opening_quantity + receipt_quantity - closing_quantity) STORED,
    remarks TEXT,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(closing_date, raw_material_id)
);

-- Daily Production Entry for consumption calculation
CREATE TABLE public.consumption_production_entry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_date DATE NOT NULL,
    product_id UUID REFERENCES public.products(id) ON DELETE CASCADE NOT NULL,
    quantity_produced NUMERIC(12, 4) NOT NULL DEFAULT 0,
    unit VARCHAR(50) DEFAULT 'dzns',
    remarks TEXT,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(entry_date, product_id)
);

-- Enable RLS on all tables
ALTER TABLE public.consumption_raw_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_stock_closing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_production_entry ENABLE ROW LEVEL SECURITY;

-- RLS Policies for consumption_raw_materials
CREATE POLICY "Users with view permission can read raw materials"
ON public.consumption_raw_materials FOR SELECT
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'view'));

CREATE POLICY "Users with create permission can insert raw materials"
ON public.consumption_raw_materials FOR INSERT
WITH CHECK (public.has_module_permission(auth.uid(), 'material_consumption', 'create'));

CREATE POLICY "Users with edit permission can update raw materials"
ON public.consumption_raw_materials FOR UPDATE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'edit'));

CREATE POLICY "Users with delete permission can delete raw materials"
ON public.consumption_raw_materials FOR DELETE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'delete'));

-- RLS Policies for consumption_bom
CREATE POLICY "Users with view permission can read BOM"
ON public.consumption_bom FOR SELECT
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'view'));

CREATE POLICY "Users with create permission can insert BOM"
ON public.consumption_bom FOR INSERT
WITH CHECK (public.has_module_permission(auth.uid(), 'material_consumption', 'create'));

CREATE POLICY "Users with edit permission can update BOM"
ON public.consumption_bom FOR UPDATE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'edit'));

CREATE POLICY "Users with delete permission can delete BOM"
ON public.consumption_bom FOR DELETE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'delete'));

-- RLS Policies for consumption_stock_closing
CREATE POLICY "Users with view permission can read stock closing"
ON public.consumption_stock_closing FOR SELECT
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'view'));

CREATE POLICY "Users with create permission can insert stock closing"
ON public.consumption_stock_closing FOR INSERT
WITH CHECK (public.has_module_permission(auth.uid(), 'material_consumption', 'create'));

CREATE POLICY "Users with edit permission can update stock closing"
ON public.consumption_stock_closing FOR UPDATE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'edit'));

CREATE POLICY "Users with delete permission can delete stock closing"
ON public.consumption_stock_closing FOR DELETE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'delete'));

-- RLS Policies for consumption_production_entry
CREATE POLICY "Users with view permission can read production entry"
ON public.consumption_production_entry FOR SELECT
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'view'));

CREATE POLICY "Users with create permission can insert production entry"
ON public.consumption_production_entry FOR INSERT
WITH CHECK (public.has_module_permission(auth.uid(), 'material_consumption', 'create'));

CREATE POLICY "Users with edit permission can update production entry"
ON public.consumption_production_entry FOR UPDATE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'edit'));

CREATE POLICY "Users with delete permission can delete production entry"
ON public.consumption_production_entry FOR DELETE
USING (public.has_module_permission(auth.uid(), 'material_consumption', 'delete'));

-- Triggers for updated_at
CREATE TRIGGER update_consumption_raw_materials_updated_at
    BEFORE UPDATE ON public.consumption_raw_materials
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_consumption_bom_updated_at
    BEFORE UPDATE ON public.consumption_bom
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_consumption_stock_closing_updated_at
    BEFORE UPDATE ON public.consumption_stock_closing
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_consumption_production_entry_updated_at
    BEFORE UPDATE ON public.consumption_production_entry
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();