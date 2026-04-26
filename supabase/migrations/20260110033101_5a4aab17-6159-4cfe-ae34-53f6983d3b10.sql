-- QA Process Master - stores all QA processes (e.g., Drawing, Jorr Inspection)
CREATE TABLE public.qa_processes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(20) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    department_id UUID REFERENCES public.production_departments(id),
    sequence_order INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- QA Process Parameters - dynamic fields for each process
CREATE TABLE public.qa_process_parameters (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    process_id UUID NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
    parameter_name VARCHAR(100) NOT NULL,
    parameter_type VARCHAR(20) DEFAULT 'text', -- text, number, boolean, select
    unit VARCHAR(20),
    min_value NUMERIC,
    max_value NUMERIC,
    options JSONB, -- for select type parameters
    is_required BOOLEAN DEFAULT false,
    sequence_order INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- QA Inspections - daily inspection entries
CREATE TABLE public.qa_inspections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    inspection_number VARCHAR(50) NOT NULL UNIQUE,
    process_id UUID NOT NULL REFERENCES public.qa_processes(id),
    department_id UUID NOT NULL REFERENCES public.production_departments(id),
    grade_id UUID REFERENCES public.grades(id),
    inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift VARCHAR(20) DEFAULT 'Day',
    inspector_id UUID REFERENCES public.app_users(id),
    result public.qa_result DEFAULT 'pass',
    status public.record_status DEFAULT 'draft',
    remarks TEXT,
    reviewed_by UUID REFERENCES public.app_users(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- QA Inspection Readings - actual parameter values recorded
CREATE TABLE public.qa_inspection_readings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    inspection_id UUID NOT NULL REFERENCES public.qa_inspections(id) ON DELETE CASCADE,
    parameter_id UUID NOT NULL REFERENCES public.qa_process_parameters(id),
    value_text TEXT,
    value_number NUMERIC,
    value_boolean BOOLEAN,
    is_within_spec BOOLEAN DEFAULT true,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- NCR (Non-Conformance Reports)
CREATE TABLE public.qa_ncr (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    ncr_number VARCHAR(50) NOT NULL UNIQUE,
    inspection_id UUID REFERENCES public.qa_inspections(id),
    department_id UUID NOT NULL REFERENCES public.production_departments(id),
    grade_id UUID REFERENCES public.grades(id),
    ncr_date DATE NOT NULL DEFAULT CURRENT_DATE,
    description TEXT NOT NULL,
    root_cause TEXT,
    immediate_action TEXT,
    quantity_affected NUMERIC DEFAULT 0,
    severity VARCHAR(20) DEFAULT 'medium', -- low, medium, high, critical
    status public.record_status DEFAULT 'draft',
    raised_by UUID REFERENCES public.app_users(id),
    assigned_to UUID REFERENCES public.app_users(id),
    closed_by UUID REFERENCES public.app_users(id),
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- CAPA (Corrective and Preventive Actions)
CREATE TABLE public.qa_capa (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    capa_number VARCHAR(50) NOT NULL UNIQUE,
    ncr_id UUID REFERENCES public.qa_ncr(id),
    capa_type VARCHAR(20) NOT NULL, -- corrective, preventive
    description TEXT NOT NULL,
    action_plan TEXT,
    target_date DATE,
    completion_date DATE,
    effectiveness_check TEXT,
    status public.record_status DEFAULT 'draft',
    responsible_person UUID REFERENCES public.app_users(id),
    verified_by UUID REFERENCES public.app_users(id),
    verified_at TIMESTAMP WITH TIME ZONE,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.qa_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_process_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_inspection_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_ncr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_capa ENABLE ROW LEVEL SECURITY;

-- RLS Policies for qa_processes (read by all authenticated, write by admins/managers)
CREATE POLICY "Users can view qa_processes" ON public.qa_processes FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage qa_processes" ON public.qa_processes FOR ALL TO authenticated 
    USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- RLS Policies for qa_process_parameters
CREATE POLICY "Users can view qa_process_parameters" ON public.qa_process_parameters FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage qa_process_parameters" ON public.qa_process_parameters FOR ALL TO authenticated 
    USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- RLS Policies for qa_inspections
CREATE POLICY "Users can view qa_inspections" ON public.qa_inspections FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create qa_inspections" ON public.qa_inspections FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update qa_inspections" ON public.qa_inspections FOR UPDATE TO authenticated USING (true);

-- RLS Policies for qa_inspection_readings
CREATE POLICY "Users can view qa_inspection_readings" ON public.qa_inspection_readings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can manage qa_inspection_readings" ON public.qa_inspection_readings FOR ALL TO authenticated USING (true);

-- RLS Policies for qa_ncr
CREATE POLICY "Users can view qa_ncr" ON public.qa_ncr FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create qa_ncr" ON public.qa_ncr FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update qa_ncr" ON public.qa_ncr FOR UPDATE TO authenticated USING (true);

-- RLS Policies for qa_capa
CREATE POLICY "Users can view qa_capa" ON public.qa_capa FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can create qa_capa" ON public.qa_capa FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Users can update qa_capa" ON public.qa_capa FOR UPDATE TO authenticated USING (true);

-- Function to generate inspection number
CREATE OR REPLACE FUNCTION public.generate_inspection_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.inspection_number := 'INS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_inspection_number
    BEFORE INSERT ON public.qa_inspections
    FOR EACH ROW
    WHEN (NEW.inspection_number IS NULL OR NEW.inspection_number = '')
    EXECUTE FUNCTION public.generate_inspection_number();

-- Function to generate NCR number
CREATE OR REPLACE FUNCTION public.generate_ncr_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.ncr_number := 'NCR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_ncr_number
    BEFORE INSERT ON public.qa_ncr
    FOR EACH ROW
    WHEN (NEW.ncr_number IS NULL OR NEW.ncr_number = '')
    EXECUTE FUNCTION public.generate_ncr_number();

-- Function to generate CAPA number
CREATE OR REPLACE FUNCTION public.generate_capa_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.capa_number := 'CAPA-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_capa_number
    BEFORE INSERT ON public.qa_capa
    FOR EACH ROW
    WHEN (NEW.capa_number IS NULL OR NEW.capa_number = '')
    EXECUTE FUNCTION public.generate_capa_number();

-- Update timestamp triggers
CREATE TRIGGER update_qa_processes_updated_at
    BEFORE UPDATE ON public.qa_processes
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_qa_inspections_updated_at
    BEFORE UPDATE ON public.qa_inspections
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_qa_ncr_updated_at
    BEFORE UPDATE ON public.qa_ncr
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_qa_capa_updated_at
    BEFORE UPDATE ON public.qa_capa
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();