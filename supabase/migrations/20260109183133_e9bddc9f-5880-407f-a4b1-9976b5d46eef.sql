
-- Enable pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Enums
CREATE TYPE public.app_role AS ENUM ('super_admin', 'admin', 'manager', 'supervisor', 'operator', 'viewer');
CREATE TYPE public.record_status AS ENUM ('draft', 'in_progress', 'pending_approval', 'approved', 'rejected', 'closed');
CREATE TYPE public.purchase_category AS ENUM ('raw_material', 'office_supplies', 'general_supplies', 'spare_maintenance');
CREATE TYPE public.qa_result AS ENUM ('pass', 'fail', 'hold');
CREATE TYPE public.priority_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE public.shift_type AS ENUM ('morning', 'afternoon', 'night');

-- Production Departments
CREATE TABLE public.production_departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    code VARCHAR(20) NOT NULL UNIQUE,
    sequence_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Grades
CREATE TABLE public.grades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    code VARCHAR(10) NOT NULL UNIQUE,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Units of Measure
CREATE TABLE public.units_of_measure (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) NOT NULL UNIQUE,
    symbol VARCHAR(10) NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- App Users
CREATE TABLE public.app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department_id UUID REFERENCES public.production_departments(id),
    designation VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- User Roles
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, role)
);

-- Module Permissions
CREATE TABLE public.module_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE NOT NULL,
    module_name VARCHAR(50) NOT NULL,
    can_view BOOLEAN DEFAULT false,
    can_create BOOLEAN DEFAULT false,
    can_edit BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    can_approve BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, module_name)
);

-- Purchase Category Permissions
CREATE TABLE public.purchase_category_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id) ON DELETE CASCADE NOT NULL,
    category purchase_category NOT NULL,
    can_view BOOLEAN DEFAULT false,
    can_create BOOLEAN DEFAULT false,
    can_approve BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (user_id, category)
);

-- Audit Log
CREATE TABLE public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.app_users(id),
    action VARCHAR(50) NOT NULL,
    module VARCHAR(50) NOT NULL,
    record_id UUID,
    record_type VARCHAR(100),
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Designations
CREATE TABLE public.designations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    department_id UUID REFERENCES public.production_departments(id),
    level INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Machines
CREATE TABLE public.machines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    department_id UUID REFERENCES public.production_departments(id),
    machine_type VARCHAR(100),
    manufacturer VARCHAR(255),
    model VARCHAR(100),
    serial_number VARCHAR(100),
    installation_date DATE,
    status VARCHAR(50) DEFAULT 'active',
    specifications JSONB,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Employees
CREATE TABLE public.employees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_code VARCHAR(50) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    department_id UUID REFERENCES public.production_departments(id),
    designation_id UUID REFERENCES public.designations(id),
    joining_date DATE,
    contact_number VARCHAR(20),
    emergency_contact VARCHAR(20),
    address TEXT,
    status VARCHAR(50) DEFAULT 'active',
    app_user_id UUID REFERENCES public.app_users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Customers
CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    gst_number VARCHAR(50),
    credit_limit DECIMAL(15,2) DEFAULT 0,
    payment_terms INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Suppliers
CREATE TABLE public.suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    country VARCHAR(100) DEFAULT 'India',
    gst_number VARCHAR(50),
    payment_terms INTEGER DEFAULT 30,
    lead_time_days INTEGER DEFAULT 7,
    rating DECIMAL(3,2) DEFAULT 0,
    categories purchase_category[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Items
CREATE TABLE public.items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category purchase_category,
    uom_id UUID REFERENCES public.units_of_measure(id),
    min_stock DECIMAL(15,3) DEFAULT 0,
    max_stock DECIMAL(15,3) DEFAULT 0,
    reorder_level DECIMAL(15,3) DEFAULT 0,
    unit_price DECIMAL(15,2) DEFAULT 0,
    is_inventory_item BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Products
CREATE TABLE public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    grade_id UUID REFERENCES public.grades(id),
    uom_id UUID REFERENCES public.units_of_measure(id),
    standard_output_rate DECIMAL(15,3),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Downtime Reasons
CREATE TABLE public.downtime_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100),
    is_planned BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Scrap Reasons
CREATE TABLE public.scrap_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    department_id UUID REFERENCES public.production_departments(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Defect Reasons
CREATE TABLE public.defect_reasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    severity VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Functions
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.has_module_permission(_user_id UUID, _module VARCHAR, _permission VARCHAR)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.module_permissions mp
        WHERE mp.user_id = _user_id AND mp.module_name = _module
        AND ((_permission = 'view' AND mp.can_view) OR (_permission = 'create' AND mp.can_create) OR
             (_permission = 'edit' AND mp.can_edit) OR (_permission = 'delete' AND mp.can_delete) OR
             (_permission = 'approve' AND mp.can_approve))
    )
$$;

CREATE OR REPLACE FUNCTION public.create_app_user(p_user_id VARCHAR, p_password VARCHAR, p_full_name VARCHAR, p_department_id UUID DEFAULT NULL, p_designation VARCHAR DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new_id UUID;
BEGIN
    INSERT INTO public.app_users (user_id, password_hash, full_name, department_id, designation)
    VALUES (p_user_id, extensions.crypt(p_password, extensions.gen_salt('bf')), p_full_name, p_department_id, p_designation)
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_user_password(p_user_id VARCHAR, p_password VARCHAR)
RETURNS TABLE(user_uuid UUID, is_valid BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_uuid UUID; v_password_hash TEXT;
BEGIN
    SELECT id, password_hash INTO v_user_uuid, v_password_hash FROM public.app_users WHERE user_id = p_user_id AND is_active = true;
    IF v_user_uuid IS NULL THEN RETURN QUERY SELECT NULL::UUID, false; RETURN; END IF;
    IF v_password_hash = extensions.crypt(p_password, v_password_hash) THEN
        UPDATE public.app_users SET last_login = now() WHERE id = v_user_uuid;
        RETURN QUERY SELECT v_user_uuid, true;
    ELSE RETURN QUERY SELECT NULL::UUID, false; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_user_password(p_user_uuid UUID, p_new_password VARCHAR)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.app_users SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() WHERE id = p_user_uuid;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

-- Triggers
CREATE TRIGGER update_app_users_updated_at BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_machines_updated_at BEFORE UPDATE ON public.machines FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_items_updated_at BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_category_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.downtime_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrap_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_reasons ENABLE ROW LEVEL SECURITY;

-- Policies - public read
CREATE POLICY "Public read" ON public.production_departments FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.grades FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.machines FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.designations FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.employees FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.units_of_measure FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.items FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.downtime_reasons FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.scrap_reasons FOR SELECT USING (true);
CREATE POLICY "Public read" ON public.defect_reasons FOR SELECT USING (true);

-- Policies - full access for management
CREATE POLICY "Full access" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.user_roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.module_permissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.purchase_category_permissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.production_departments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.grades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.machines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.designations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.units_of_measure FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.downtime_reasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.scrap_reasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.defect_reasons FOR ALL USING (true) WITH CHECK (true);

-- Seed: Departments
INSERT INTO public.production_departments (name, code, sequence_order) VALUES ('Press', 'PRESS', 1);
INSERT INTO public.production_departments (name, code, sequence_order) VALUES ('Jorr', 'JORR', 2);
INSERT INTO public.production_departments (name, code, sequence_order) VALUES ('Local Final', 'LOCAL_FINAL', 3);
INSERT INTO public.production_departments (name, code, sequence_order) VALUES ('Fancy Final', 'FANCY_FINAL', 4);
INSERT INTO public.production_departments (name, code, sequence_order) VALUES ('Packing', 'PACKING', 5);

-- Seed: Grades
INSERT INTO public.grades (name, code, description) VALUES ('LB', 'LB', 'Grade LB');
INSERT INTO public.grades (name, code, description) VALUES ('FB', 'FB', 'Grade FB');
INSERT INTO public.grades (name, code, description) VALUES ('KB', 'KB', 'Grade KB');
INSERT INTO public.grades (name, code, description) VALUES ('T', 'T', 'Grade T');
INSERT INTO public.grades (name, code, description) VALUES ('VM', 'VM', 'Grade VM');
INSERT INTO public.grades (name, code, description) VALUES ('V', 'V', 'Grade V');

-- Seed: UOM
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Kilogram', 'kg');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Pieces', 'pcs');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Meter', 'm');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Roll', 'roll');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Dozen', 'doz');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Liter', 'L');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Box', 'box');
INSERT INTO public.units_of_measure (name, symbol) VALUES ('Set', 'set');

-- Seed: Downtime Reasons
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT01', 'Machine Breakdown', 'Mechanical', false);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT02', 'Power Failure', 'Electrical', false);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT03', 'Material Shortage', 'Supply', false);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT04', 'Tool Change', 'Setup', true);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT05', 'Preventive Maintenance', 'Maintenance', true);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT06', 'Quality Hold', 'Quality', false);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT07', 'Operator Unavailable', 'Manpower', false);
INSERT INTO public.downtime_reasons (code, name, category, is_planned) VALUES ('PDT08', 'Shift Change', 'Operations', true);

-- Seed: Scrap Reasons
INSERT INTO public.scrap_reasons (code, name) VALUES ('SCR01', 'Dimensional Deviation');
INSERT INTO public.scrap_reasons (code, name) VALUES ('SCR02', 'Surface Defect');
INSERT INTO public.scrap_reasons (code, name) VALUES ('SCR03', 'Material Defect');
INSERT INTO public.scrap_reasons (code, name) VALUES ('SCR04', 'Process Failure');
INSERT INTO public.scrap_reasons (code, name) VALUES ('SCR05', 'Handling Damage');

-- Seed: Defect Reasons
INSERT INTO public.defect_reasons (code, name, severity) VALUES ('DEF01', 'Crack', 'Critical');
INSERT INTO public.defect_reasons (code, name, severity) VALUES ('DEF02', 'Scratch', 'Minor');
INSERT INTO public.defect_reasons (code, name, severity) VALUES ('DEF03', 'Discoloration', 'Major');
INSERT INTO public.defect_reasons (code, name, severity) VALUES ('DEF04', 'Dimensional Error', 'Critical');
INSERT INTO public.defect_reasons (code, name, severity) VALUES ('DEF05', 'Porosity', 'Major');
INSERT INTO public.defect_reasons (code, name, severity) VALUES ('DEF06', 'Contamination', 'Critical');

-- Seed: Designations
INSERT INTO public.designations (name, level) VALUES ('Production Manager', 5);
INSERT INTO public.designations (name, level) VALUES ('Shift Supervisor', 4);
INSERT INTO public.designations (name, level) VALUES ('Machine Operator', 2);
INSERT INTO public.designations (name, level) VALUES ('Quality Inspector', 3);
INSERT INTO public.designations (name, level) VALUES ('Maintenance Technician', 3);
INSERT INTO public.designations (name, level) VALUES ('Helper', 1);

-- Seed: Customers
INSERT INTO public.customers (code, name, contact_person, phone, city) VALUES ('CUS001', 'ABC Sports Goods', 'Mr. Mehta', '9898989898', 'Mumbai');
INSERT INTO public.customers (code, name, contact_person, phone, city) VALUES ('CUS002', 'XYZ Distributors', 'Ms. Joshi', '9797979797', 'Delhi');
INSERT INTO public.customers (code, name, contact_person, phone, city) VALUES ('CUS003', 'Sports World Ltd', 'Mr. Reddy', '9696969696', 'Bangalore');

-- Seed: Suppliers
INSERT INTO public.suppliers (code, name, contact_person, phone, categories) VALUES ('SUP001', 'Raw Materials Corp', 'Mr. Sharma', '9876543210', ARRAY['raw_material']::purchase_category[]);
INSERT INTO public.suppliers (code, name, contact_person, phone, categories) VALUES ('SUP002', 'Office Essentials Ltd', 'Ms. Gupta', '9876543211', ARRAY['office_supplies']::purchase_category[]);
INSERT INTO public.suppliers (code, name, contact_person, phone, categories) VALUES ('SUP003', 'Industrial Spares Inc', 'Mr. Verma', '9876543212', ARRAY['spare_maintenance']::purchase_category[]);
INSERT INTO public.suppliers (code, name, contact_person, phone, categories) VALUES ('SUP004', 'General Trading Co', 'Mr. Khan', '9876543213', ARRAY['general_supplies', 'office_supplies']::purchase_category[]);

-- Create admin user
SELECT public.create_app_user('admin', 'admin123', 'System Administrator', NULL, 'Super Admin');
