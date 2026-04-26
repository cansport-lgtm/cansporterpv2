-- =====================================================
-- CANSPORT ERP - Complete Database Schema Export
-- Generated on: 2026-01-20
-- =====================================================

-- =====================================================
-- SECTION 1: ENUM TYPES
-- =====================================================

CREATE TYPE public.app_role AS ENUM (
    'super_admin',
    'admin',
    'manager',
    'supervisor',
    'operator',
    'viewer',
    'operational_manager',
    'qa_manager',
    'maintenance_manager',
    'sales_executive',
    'order_management',
    'floor_incharge'
);

CREATE TYPE public.packing_option AS ENUM (
    '12_dz_ctns',
    '20_dz_bag',
    '60_dz_bag',
    '20_dz_ctn',
    '6_dz_ctn'
);

CREATE TYPE public.priority_level AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);

CREATE TYPE public.purchase_category AS ENUM (
    'raw_material',
    'office_supplies',
    'general_supplies',
    'spare_maintenance'
);

CREATE TYPE public.qa_result AS ENUM (
    'pass',
    'fail',
    'hold'
);

CREATE TYPE public.record_status AS ENUM (
    'draft',
    'in_progress',
    'pending_approval',
    'approved',
    'rejected',
    'closed'
);

CREATE TYPE public.sales_segment AS ENUM (
    'private_label',
    'domestic',
    'export'
);

CREATE TYPE public.shift_type AS ENUM (
    'morning',
    'afternoon',
    'night'
);

-- =====================================================
-- SECTION 2: SEQUENCES
-- =====================================================

CREATE SEQUENCE IF NOT EXISTS public.dispatch_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.grn_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.production_order_seq;
CREATE SEQUENCE IF NOT EXISTS public.purchase_order_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.quotation_number_seq;
CREATE SEQUENCE IF NOT EXISTS public.sales_order_number_seq;

-- =====================================================
-- SECTION 3: TABLES
-- =====================================================

-- Table: app_users
CREATE TABLE public.app_users (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    department_id UUID,
    designation VARCHAR(100),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: attendance
CREATE TABLE public.attendance (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in TIME,
    check_out TIME,
    status VARCHAR(20) NOT NULL DEFAULT 'present',
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(employee_id, attendance_date)
);

-- Table: audit_log
CREATE TABLE public.audit_log (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID,
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

-- Table: breakdown_logs
CREATE TABLE public.breakdown_logs (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    breakdown_number VARCHAR NOT NULL UNIQUE,
    machine_id UUID NOT NULL,
    downtime_reason_id UUID,
    work_order_id UUID,
    breakdown_start TIMESTAMPTZ NOT NULL,
    breakdown_end TIMESTAMPTZ,
    downtime_minutes INTEGER,
    priority public.priority_level DEFAULT 'high',
    reported_by UUID,
    resolved_by UUID,
    status public.record_status DEFAULT 'in_progress',
    description TEXT NOT NULL,
    root_cause TEXT,
    immediate_action TEXT,
    technician_name TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: customer_logos
CREATE TABLE public.customer_logos (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id UUID NOT NULL,
    logo_url TEXT NOT NULL,
    label TEXT,
    is_primary BOOLEAN DEFAULT false,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_logos_customer_id ON public.customer_logos(customer_id);

-- Table: customer_pricing
CREATE TABLE public.customer_pricing (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id UUID NOT NULL,
    product_id UUID NOT NULL,
    price_per_dozen NUMERIC NOT NULL,
    min_quantity_dozens INTEGER DEFAULT 1,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(customer_id, product_id, effective_from)
);

-- Table: customer_visits
CREATE TABLE public.customer_visits (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    visit_number VARCHAR NOT NULL UNIQUE,
    customer_id UUID NOT NULL,
    salesman_id UUID,
    visit_date DATE NOT NULL DEFAULT CURRENT_DATE,
    visit_type VARCHAR NOT NULL DEFAULT 'regular',
    purpose TEXT,
    outcome TEXT,
    feedback TEXT,
    check_in_time TIMESTAMPTZ,
    check_out_time TIMESTAMPTZ,
    duration_minutes INTEGER,
    latitude NUMERIC,
    longitude NUMERIC,
    order_taken BOOLEAN DEFAULT false,
    order_value NUMERIC,
    follow_up_required BOOLEAN DEFAULT false,
    follow_up_date DATE,
    next_action TEXT,
    status VARCHAR NOT NULL DEFAULT 'completed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_visits_customer_id ON public.customer_visits(customer_id);
CREATE INDEX idx_customer_visits_salesman_id ON public.customer_visits(salesman_id);
CREATE INDEX idx_customer_visits_visit_date ON public.customer_visits(visit_date);

-- Table: customers
CREATE TABLE public.customers (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    contact_person VARCHAR,
    email VARCHAR,
    phone VARCHAR,
    address TEXT,
    city VARCHAR,
    state VARCHAR,
    country VARCHAR DEFAULT 'India',
    gst_number VARCHAR,
    area VARCHAR,
    sales_segment public.sales_segment NOT NULL DEFAULT 'private_label',
    credit_limit NUMERIC DEFAULT 0,
    payment_terms INTEGER DEFAULT 30,
    logo_url TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(code, sales_segment)
);
CREATE INDEX idx_customers_segment ON public.customers(sales_segment);

-- Table: defect_reasons
CREATE TABLE public.defect_reasons (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    severity VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: designations
CREATE TABLE public.designations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    department_id UUID,
    level INTEGER DEFAULT 1,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: development_tasks
CREATE TABLE public.development_tasks (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    task_number VARCHAR NOT NULL UNIQUE,
    title VARCHAR NOT NULL,
    description TEXT,
    module VARCHAR,
    priority public.priority_level DEFAULT 'medium',
    status public.record_status DEFAULT 'draft',
    estimated_hours NUMERIC,
    actual_hours NUMERIC,
    target_date DATE,
    completed_date DATE,
    assigned_to UUID,
    created_by UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: downtime_reasons
CREATE TABLE public.downtime_reasons (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    category VARCHAR,
    is_planned BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: employee_loans
CREATE TABLE public.employee_loans (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    loan_date DATE NOT NULL DEFAULT CURRENT_DATE,
    loan_amount NUMERIC NOT NULL,
    interest_rate NUMERIC DEFAULT 0,
    total_installments INTEGER NOT NULL,
    monthly_installment NUMERIC NOT NULL,
    remaining_amount NUMERIC NOT NULL,
    paid_installments INTEGER DEFAULT 0,
    repayment_start_date DATE,
    status VARCHAR DEFAULT 'pending',
    purpose TEXT,
    remarks TEXT,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: employees
CREATE TABLE public.employees (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code VARCHAR NOT NULL UNIQUE,
    full_name VARCHAR NOT NULL,
    department_id UUID,
    designation_id UUID,
    contact_number VARCHAR,
    address TEXT,
    emergency_contact VARCHAR,
    joining_date DATE,
    basic_salary NUMERIC DEFAULT 0,
    allowances NUMERIC DEFAULT 0,
    status VARCHAR DEFAULT 'active',
    is_active BOOLEAN DEFAULT true,
    app_user_id UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: goods_receipt_notes
CREATE TABLE public.goods_receipt_notes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    grn_number VARCHAR NOT NULL UNIQUE,
    purchase_order_id UUID NOT NULL,
    supplier_id UUID NOT NULL,
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    invoice_number VARCHAR,
    invoice_date DATE,
    invoice_amount NUMERIC,
    total_amount NUMERIC DEFAULT 0,
    status VARCHAR NOT NULL DEFAULT 'draft',
    notes TEXT,
    received_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: grades
CREATE TABLE public.grades (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: grn_items
CREATE TABLE public.grn_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    grn_id UUID NOT NULL,
    po_item_id UUID,
    item_id UUID,
    description TEXT,
    quantity_ordered NUMERIC DEFAULT 0,
    quantity_received NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: items
CREATE TABLE public.items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    category public.purchase_category,
    uom_id UUID,
    unit_price NUMERIC DEFAULT 0,
    min_stock NUMERIC DEFAULT 0,
    max_stock NUMERIC DEFAULT 0,
    reorder_level NUMERIC DEFAULT 0,
    is_inventory_item BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: job_candidates
CREATE TABLE public.job_candidates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    job_posting_id UUID NOT NULL,
    candidate_name VARCHAR NOT NULL,
    email VARCHAR,
    phone VARCHAR,
    experience_years NUMERIC,
    current_salary NUMERIC,
    expected_salary NUMERIC,
    resume_url TEXT,
    status VARCHAR NOT NULL DEFAULT 'applied',
    interview_date TIMESTAMPTZ,
    interview_notes TEXT,
    rating INTEGER,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: job_postings
CREATE TABLE public.job_postings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    job_code VARCHAR NOT NULL UNIQUE,
    title VARCHAR NOT NULL,
    description TEXT,
    requirements TEXT,
    department_id UUID,
    designation_id UUID,
    positions INTEGER DEFAULT 1,
    status VARCHAR NOT NULL DEFAULT 'draft',
    salary_range_min NUMERIC,
    salary_range_max NUMERIC,
    posted_date DATE,
    closing_date DATE,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: labour_employees
CREATE TABLE public.labour_employees (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    department_id UUID,
    contact_number TEXT,
    monthly_salary NUMERIC DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: labour_productivity_targets
CREATE TABLE public.labour_productivity_targets (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    department_id UUID NOT NULL,
    process_id UUID,
    target_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift VARCHAR DEFAULT 'Day',
    work_type TEXT NOT NULL DEFAULT 'full_day',
    target_quantity INTEGER NOT NULL DEFAULT 0,
    actual_quantity INTEGER NOT NULL DEFAULT 0,
    efficiency_percentage NUMERIC,
    mph NUMERIC,
    uom_id UUID,
    status TEXT NOT NULL DEFAULT 'draft',
    remarks TEXT,
    created_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: leave_requests
CREATE TABLE public.leave_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    leave_type_id UUID NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days NUMERIC NOT NULL,
    reason TEXT,
    status VARCHAR NOT NULL DEFAULT 'pending',
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    remarks TEXT,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: leave_types
CREATE TABLE public.leave_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    days_per_year INTEGER DEFAULT 0,
    is_paid BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: machines
CREATE TABLE public.machines (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    machine_type VARCHAR,
    department_id UUID,
    manufacturer VARCHAR,
    model VARCHAR,
    serial_number VARCHAR,
    installation_date DATE,
    status VARCHAR DEFAULT 'active',
    specifications JSONB,
    notes TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: maintenance_schedules
CREATE TABLE public.maintenance_schedules (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    schedule_number VARCHAR NOT NULL UNIQUE,
    title VARCHAR NOT NULL,
    description TEXT,
    machine_id UUID,
    maintenance_type_id UUID,
    frequency_days INTEGER NOT NULL,
    last_performed_date DATE,
    next_due_date DATE NOT NULL,
    priority public.priority_level DEFAULT 'medium',
    estimated_duration_hours NUMERIC,
    assigned_to UUID,
    technician_name TEXT,
    instructions TEXT,
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: maintenance_types
CREATE TABLE public.maintenance_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: maintenance_work_orders
CREATE TABLE public.maintenance_work_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_number VARCHAR NOT NULL UNIQUE,
    title VARCHAR NOT NULL,
    description TEXT,
    machine_id UUID,
    maintenance_type_id UUID,
    schedule_id UUID,
    downtime_reason_id UUID,
    priority public.priority_level DEFAULT 'medium',
    status public.record_status DEFAULT 'draft',
    requested_date DATE NOT NULL DEFAULT CURRENT_DATE,
    scheduled_date DATE,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    estimated_hours NUMERIC,
    actual_hours NUMERIC,
    requested_by UUID,
    assigned_to UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    technician_name TEXT,
    root_cause TEXT,
    action_taken TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: module_permissions
CREATE TABLE public.module_permissions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    module_name VARCHAR NOT NULL,
    can_view BOOLEAN DEFAULT false,
    can_create BOOLEAN DEFAULT false,
    can_edit BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    can_approve BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: performance_goals
CREATE TABLE public.performance_goals (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    review_cycle_id UUID NOT NULL,
    kpi_id UUID NOT NULL,
    target_value NUMERIC NOT NULL,
    actual_value NUMERIC,
    weight NUMERIC DEFAULT 1.0,
    score NUMERIC,
    status VARCHAR NOT NULL DEFAULT 'pending',
    assigned_by UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: performance_kpis
CREATE TABLE public.performance_kpis (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    category VARCHAR,
    measurement_type VARCHAR NOT NULL DEFAULT 'numeric',
    unit VARCHAR,
    target_direction VARCHAR DEFAULT 'higher',
    min_value NUMERIC,
    max_value NUMERIC,
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: performance_review_cycles
CREATE TABLE public.performance_review_cycles (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR NOT NULL,
    description TEXT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'draft',
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: performance_reviews
CREATE TABLE public.performance_reviews (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL,
    review_cycle_id UUID NOT NULL,
    reviewer_id UUID,
    overall_score NUMERIC,
    overall_rating VARCHAR,
    strengths TEXT,
    areas_for_improvement TEXT,
    reviewer_comments TEXT,
    employee_comments TEXT,
    status VARCHAR NOT NULL DEFAULT 'draft',
    reviewed_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: production_departments
CREATE TABLE public.production_departments (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    sequence_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: production_entries
CREATE TABLE public.production_entries (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    department_id UUID NOT NULL,
    machine_id UUID,
    grade_id UUID NOT NULL,
    shift VARCHAR NOT NULL DEFAULT 'Day',
    target_production INTEGER NOT NULL DEFAULT 0,
    quantity_produced NUMERIC NOT NULL DEFAULT 0,
    quantity_ok NUMERIC NOT NULL DEFAULT 0,
    quantity_rejected NUMERIC NOT NULL DEFAULT 0,
    uom_id UUID,
    operator_id UUID,
    supervisor_id UUID,
    status VARCHAR NOT NULL DEFAULT 'Draft',
    remarks TEXT,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: production_order_items
CREATE TABLE public.production_order_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL,
    product_id UUID,
    grade_id UUID,
    packing_type public.packing_option NOT NULL,
    quantity_dozens NUMERIC NOT NULL DEFAULT 0,
    quantity_produced NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: production_orders
CREATE TABLE public.production_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_number VARCHAR NOT NULL UNIQUE,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id UUID,
    status VARCHAR NOT NULL DEFAULT 'draft',
    priority VARCHAR DEFAULT 'medium',
    due_date DATE,
    remarks TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: production_rejections
CREATE TABLE public.production_rejections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    production_entry_id UUID NOT NULL,
    defect_reason_id UUID NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: products
CREATE TABLE public.products (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    category VARCHAR,
    grade_id UUID,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: purchase_category_permissions
CREATE TABLE public.purchase_category_permissions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    category public.purchase_category NOT NULL,
    can_view BOOLEAN DEFAULT false,
    can_create BOOLEAN DEFAULT false,
    can_edit BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    can_approve BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, category)
);

-- Table: purchase_order_items
CREATE TABLE public.purchase_order_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    purchase_order_id UUID NOT NULL,
    item_id UUID,
    description TEXT,
    quantity NUMERIC NOT NULL DEFAULT 0,
    quantity_received NUMERIC DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: purchase_orders
CREATE TABLE public.purchase_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    po_number VARCHAR NOT NULL UNIQUE,
    supplier_id UUID NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    category public.purchase_category NOT NULL,
    status VARCHAR NOT NULL DEFAULT 'draft',
    total_amount NUMERIC DEFAULT 0,
    notes TEXT,
    requested_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: qa_capa
CREATE TABLE public.qa_capa (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    capa_number VARCHAR NOT NULL UNIQUE,
    ncr_id UUID NOT NULL,
    capa_type VARCHAR NOT NULL DEFAULT 'corrective',
    root_cause TEXT,
    action_plan TEXT,
    responsible_person UUID,
    target_date DATE,
    completion_date DATE,
    verification_date DATE,
    verified_by UUID,
    status VARCHAR NOT NULL DEFAULT 'open',
    effectiveness VARCHAR,
    remarks TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: qa_inspection_readings
CREATE TABLE public.qa_inspection_readings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    inspection_id UUID NOT NULL,
    parameter_id UUID NOT NULL,
    reading_value NUMERIC,
    reading_text TEXT,
    is_pass BOOLEAN,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: qa_inspections
CREATE TABLE public.qa_inspections (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    inspection_number VARCHAR NOT NULL UNIQUE,
    process_id UUID NOT NULL,
    production_entry_id UUID,
    machine_id UUID,
    inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
    shift VARCHAR DEFAULT 'Day',
    sample_size INTEGER DEFAULT 1,
    result public.qa_result NOT NULL DEFAULT 'pass',
    overall_remarks TEXT,
    inspector_id UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    status VARCHAR NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: qa_ncr
CREATE TABLE public.qa_ncr (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    ncr_number VARCHAR NOT NULL UNIQUE,
    inspection_id UUID,
    production_entry_id UUID,
    defect_reason_id UUID,
    ncr_date DATE NOT NULL DEFAULT CURRENT_DATE,
    source VARCHAR NOT NULL DEFAULT 'internal',
    severity VARCHAR NOT NULL DEFAULT 'minor',
    quantity_affected NUMERIC DEFAULT 0,
    description TEXT NOT NULL,
    immediate_action TEXT,
    disposition VARCHAR,
    status VARCHAR NOT NULL DEFAULT 'open',
    raised_by UUID,
    closed_by UUID,
    closed_at TIMESTAMPTZ,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: qa_process_parameters
CREATE TABLE public.qa_process_parameters (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    process_id UUID NOT NULL,
    parameter_name VARCHAR NOT NULL,
    parameter_type VARCHAR NOT NULL DEFAULT 'numeric',
    unit VARCHAR,
    min_value NUMERIC,
    max_value NUMERIC,
    target_value NUMERIC,
    is_critical BOOLEAN DEFAULT false,
    sequence_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: qa_processes
CREATE TABLE public.qa_processes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    department_id UUID,
    description TEXT,
    inspection_frequency VARCHAR DEFAULT 'per_batch',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: sales_dispatch_items
CREATE TABLE public.sales_dispatch_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    dispatch_order_id UUID NOT NULL,
    order_item_id UUID NOT NULL,
    quantity_dozens NUMERIC NOT NULL DEFAULT 0,
    packing_type public.packing_option NOT NULL,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: sales_dispatch_orders
CREATE TABLE public.sales_dispatch_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    dispatch_id UUID NOT NULL,
    order_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: sales_dispatches
CREATE TABLE public.sales_dispatches (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    dispatch_number VARCHAR NOT NULL UNIQUE,
    dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id UUID NOT NULL,
    vehicle_number VARCHAR,
    driver_name VARCHAR,
    driver_contact VARCHAR,
    transporter_name VARCHAR,
    lr_number VARCHAR,
    lr_date DATE,
    freight_amount NUMERIC DEFAULT 0,
    freight_paid_by VARCHAR DEFAULT 'customer',
    total_boxes INTEGER DEFAULT 0,
    total_dozens NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    status VARCHAR NOT NULL DEFAULT 'draft',
    remarks TEXT,
    dispatched_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: sales_order_items
CREATE TABLE public.sales_order_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_id UUID NOT NULL,
    product_id UUID,
    grade_id UUID,
    packing_type public.packing_option NOT NULL,
    quantity_dozens NUMERIC NOT NULL DEFAULT 0,
    quantity_dispatched NUMERIC DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: sales_orders
CREATE TABLE public.sales_orders (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    order_number VARCHAR NOT NULL UNIQUE,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id UUID NOT NULL,
    sales_segment public.sales_segment NOT NULL DEFAULT 'private_label',
    delivery_date DATE,
    po_number VARCHAR,
    po_date DATE,
    status VARCHAR NOT NULL DEFAULT 'draft',
    total_dozens NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    remarks TEXT,
    created_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_orders_segment ON public.sales_orders(sales_segment);

-- Table: sales_quotation_items
CREATE TABLE public.sales_quotation_items (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    quotation_id UUID NOT NULL,
    product_id UUID,
    grade_id UUID,
    packing_type public.packing_option NOT NULL,
    quantity_dozens NUMERIC NOT NULL DEFAULT 0,
    unit_price NUMERIC NOT NULL DEFAULT 0,
    amount NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: sales_quotations
CREATE TABLE public.sales_quotations (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    quotation_number VARCHAR NOT NULL UNIQUE,
    quotation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    customer_id UUID NOT NULL,
    sales_segment public.sales_segment NOT NULL DEFAULT 'private_label',
    valid_until DATE,
    status VARCHAR NOT NULL DEFAULT 'draft',
    total_dozens NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    terms_conditions TEXT,
    remarks TEXT,
    created_by UUID,
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sales_quotations_segment ON public.sales_quotations(sales_segment);

-- Table: scrap_reasons
CREATE TABLE public.scrap_reasons (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: spare_part_issues
CREATE TABLE public.spare_part_issues (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    issue_number VARCHAR NOT NULL UNIQUE,
    issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
    spare_part_id UUID NOT NULL,
    work_order_id UUID,
    machine_id UUID,
    quantity_issued NUMERIC NOT NULL DEFAULT 0,
    issued_to UUID,
    purpose TEXT,
    remarks TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: spare_parts
CREATE TABLE public.spare_parts (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    description TEXT,
    category VARCHAR,
    machine_id UUID,
    uom_id UUID,
    current_stock NUMERIC DEFAULT 0,
    min_stock NUMERIC DEFAULT 0,
    max_stock NUMERIC DEFAULT 0,
    reorder_level NUMERIC DEFAULT 0,
    unit_price NUMERIC DEFAULT 0,
    location VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: suppliers
CREATE TABLE public.suppliers (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    contact_person VARCHAR,
    email VARCHAR,
    phone VARCHAR,
    address TEXT,
    city VARCHAR,
    state VARCHAR,
    country VARCHAR DEFAULT 'India',
    gst_number VARCHAR,
    payment_terms INTEGER DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Table: units_of_measure
CREATE TABLE public.units_of_measure (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR NOT NULL UNIQUE,
    name VARCHAR NOT NULL,
    symbol VARCHAR,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Table: user_roles
CREATE TABLE public.user_roles (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    role public.app_role NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, role)
);

-- Table: wip_inventory
CREATE TABLE public.wip_inventory (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    production_entry_id UUID,
    department_id UUID NOT NULL,
    grade_id UUID NOT NULL,
    entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
    quantity_in NUMERIC DEFAULT 0,
    quantity_out NUMERIC DEFAULT 0,
    balance NUMERIC DEFAULT 0,
    uom_id UUID,
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: work_order_spare_parts
CREATE TABLE public.work_order_spare_parts (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    work_order_id UUID NOT NULL,
    spare_part_id UUID NOT NULL,
    quantity_used NUMERIC NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- =====================================================
-- SECTION 4: ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.breakdown_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_logos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.defect_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.designations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.development_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.downtime_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grn_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labour_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labour_productivity_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.module_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_rejections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_category_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_capa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_inspection_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_ncr ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_process_parameters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_processes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_dispatch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_dispatch_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scrap_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_part_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spare_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.units_of_measure ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wip_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_order_spare_parts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Full access" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.audit_log FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.breakdown_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Anyone can view customer logos" ON public.customer_logos FOR SELECT USING (true);
CREATE POLICY "Anyone can insert customer logos" ON public.customer_logos FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update customer logos" ON public.customer_logos FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete customer logos" ON public.customer_logos FOR DELETE USING (true);
CREATE POLICY "Allow all for customer_pricing" ON public.customer_pricing FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow full access to customer_visits" ON public.customer_visits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.defect_reasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.defect_reasons FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.designations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.designations FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated" ON public.development_tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.downtime_reasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.downtime_reasons FOR SELECT USING (true);
CREATE POLICY "Allow all operations for anon users" ON public.employee_loans FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.employees FOR SELECT USING (true);
CREATE POLICY "Allow all operations on goods_receipt_notes" ON public.goods_receipt_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.grades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.grades FOR SELECT USING (true);
CREATE POLICY "Allow all operations on grn_items" ON public.grn_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.items FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated users" ON public.job_candidates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.job_postings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on labour_employees" ON public.labour_employees FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on labour_productivity_targets" ON public.labour_productivity_targets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.leave_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.leave_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.machines FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.machines FOR SELECT USING (true);
CREATE POLICY "Allow all for authenticated" ON public.maintenance_schedules FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.maintenance_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated" ON public.maintenance_work_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.module_permissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for performance_goals" ON public.performance_goals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for performance_kpis" ON public.performance_kpis FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for performance_review_cycles" ON public.performance_review_cycles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for performance_reviews" ON public.performance_reviews FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.production_departments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.production_departments FOR SELECT USING (true);
CREATE POLICY "Full access for production_entries" ON public.production_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow read for all" ON public.production_order_items FOR SELECT USING (true);
CREATE POLICY "Allow insert for all" ON public.production_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow update for all" ON public.production_order_items FOR UPDATE USING (true);
CREATE POLICY "Allow delete for all" ON public.production_order_items FOR DELETE USING (true);
CREATE POLICY "Allow all access to production_orders" ON public.production_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for production_rejections" ON public.production_rejections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.products FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.purchase_category_permissions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on purchase_order_items" ON public.purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for qa_capa" ON public.qa_capa FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for qa_inspection_readings" ON public.qa_inspection_readings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for qa_inspections" ON public.qa_inspections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for qa_ncr" ON public.qa_ncr FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for qa_process_parameters" ON public.qa_process_parameters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for qa_processes" ON public.qa_processes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_dispatch_items" ON public.sales_dispatch_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_dispatch_orders" ON public.sales_dispatch_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_dispatches" ON public.sales_dispatches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_order_items" ON public.sales_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_orders" ON public.sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_quotation_items" ON public.sales_quotation_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_quotations" ON public.sales_quotations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.scrap_reasons FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.scrap_reasons FOR SELECT USING (true);
CREATE POLICY "Allow all for spare_part_issues" ON public.spare_part_issues FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.spare_parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.spare_parts FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.suppliers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.units_of_measure FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read" ON public.units_of_measure FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.user_roles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for wip_inventory" ON public.wip_inventory FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for work_order_spare_parts" ON public.work_order_spare_parts FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- SECTION 5: DATABASE FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION public.generate_work_order_number()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
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
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
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
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.generate_quotation_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.quotation_number := 'QTN-' || LPAD(NEXTVAL('quotation_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_sales_order_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.order_number := 'SO-' || LPAD(NEXTVAL('sales_order_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_dispatch_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.dispatch_number := 'DC-' || LPAD(NEXTVAL('dispatch_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.po_number := 'PO-' || LPAD(NEXTVAL('purchase_order_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_grn_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.grn_number := 'GRN-' || LPAD(NEXTVAL('grn_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_dev_task_number()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.generate_visit_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(visit_number FROM 5) AS INTEGER)), 0) + 1
  INTO new_number
  FROM public.customer_visits;
  
  NEW.visit_number := 'VIS-' || LPAD(new_number::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_spare_part_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
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

CREATE OR REPLACE FUNCTION public.generate_kpi_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  next_num INTEGER;
  new_code TEXT;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)), 0) + 1 
  INTO next_num 
  FROM public.performance_kpis 
  WHERE code ~ '^KPI[0-9]+$';
  
  new_code := 'KPI' || LPAD(next_num::TEXT, 3, '0');
  RETURN new_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_job_code()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
  v_code TEXT;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM job_postings 
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  v_code := 'JOB-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_spare_part_stock_on_issue()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE spare_parts SET current_stock = current_stock - NEW.quantity_issued WHERE id = NEW.spare_part_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE spare_parts SET current_stock = current_stock + OLD.quantity_issued WHERE id = OLD.spare_part_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE spare_parts SET current_stock = current_stock + OLD.quantity_issued - NEW.quantity_issued WHERE id = NEW.spare_part_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_spare_part_issue_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  new_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(issue_number FROM 5) AS INTEGER)), 0) + 1 
  INTO new_number 
  FROM public.spare_part_issues;
  
  NEW.issue_number := 'SPI-' || LPAD(new_number::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_order_item_dispatched_qty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched + NEW.quantity_dozens
    WHERE id = NEW.order_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched - OLD.quantity_dozens
    WHERE id = OLD.order_item_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched - OLD.quantity_dozens + NEW.quantity_dozens
    WHERE id = NEW.order_item_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_po_item_received_qty()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.purchase_order_items
    SET quantity_received = quantity_received + NEW.quantity_received
    WHERE id = NEW.po_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.purchase_order_items
    SET quantity_received = quantity_received - OLD.quantity_received
    WHERE id = OLD.po_item_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.purchase_order_items
    SET quantity_received = quantity_received - OLD.quantity_received + NEW.quantity_received
    WHERE id = NEW.po_item_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_user_password(p_user_uuid uuid, p_new_password character varying)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
    UPDATE public.app_users SET password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')), updated_at = now() WHERE id = p_user_uuid;
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$ 
BEGIN 
  NEW.updated_at = now(); 
  RETURN NEW; 
END; 
$$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.generate_production_order_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
    IF NEW.order_number IS NULL OR NEW.order_number = '' THEN
        NEW.order_number := 'PO-' || TO_CHAR(CURRENT_DATE, 'YYYYMM') || '-' || LPAD(nextval('production_order_seq')::TEXT, 4, '0');
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_inspection_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.inspection_number IS NULL OR NEW.inspection_number = '' THEN
    NEW.inspection_number := 'INS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_ncr_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ncr_number IS NULL OR NEW.ncr_number = '' THEN
    NEW.ncr_number := 'NCR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_capa_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.capa_number IS NULL OR NEW.capa_number = '' THEN
    NEW.capa_number := 'CAPA-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_app_user(p_user_id character varying, p_password character varying, p_full_name character varying, p_department_id uuid DEFAULT NULL::uuid, p_designation character varying DEFAULT NULL::character varying)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_new_id UUID;
BEGIN
    INSERT INTO public.app_users (user_id, password_hash, full_name, department_id, designation)
    VALUES (p_user_id, extensions.crypt(p_password, extensions.gen_salt('bf')), p_full_name, p_department_id, p_designation)
    RETURNING id INTO v_new_id;
    RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_module_permission(_user_id uuid, _module character varying, _permission character varying)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.module_permissions mp
        WHERE mp.user_id = _user_id AND mp.module_name = _module
        AND ((_permission = 'view' AND mp.can_view) OR (_permission = 'create' AND mp.can_create) OR
             (_permission = 'edit' AND mp.can_edit) OR (_permission = 'delete' AND mp.can_delete) OR
             (_permission = 'approve' AND mp.can_approve))
    )
$$;

CREATE OR REPLACE FUNCTION public.verify_user_password(p_user_id character varying, p_password character varying)
RETURNS TABLE(user_uuid uuid, is_valid boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

-- =====================================================
-- END OF SCHEMA EXPORT
-- =====================================================
