-- Attendance table for daily tracking
CREATE TABLE public.attendance (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES public.employees(id),
    attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    check_in TIME,
    check_out TIME,
    status VARCHAR(20) NOT NULL DEFAULT 'present', -- present, absent, half_day, late, on_leave
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(employee_id, attendance_date)
);

-- Leave types master table
CREATE TABLE public.leave_types (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(10) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    days_per_year INTEGER DEFAULT 0,
    is_paid BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Leave requests table
CREATE TABLE public.leave_requests (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id UUID NOT NULL REFERENCES public.employees(id),
    leave_type_id UUID NOT NULL REFERENCES public.leave_types(id),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_days NUMERIC(4,1) NOT NULL,
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, cancelled
    applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMP WITH TIME ZONE,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Recruitment job postings
CREATE TABLE public.job_postings (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    job_code VARCHAR(20) NOT NULL UNIQUE,
    title VARCHAR(200) NOT NULL,
    department_id UUID REFERENCES public.production_departments(id),
    designation_id UUID REFERENCES public.designations(id),
    description TEXT,
    requirements TEXT,
    positions INTEGER DEFAULT 1,
    salary_range_min NUMERIC(12,2),
    salary_range_max NUMERIC(12,2),
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, open, closed, on_hold
    posted_date DATE,
    closing_date DATE,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Job candidates
CREATE TABLE public.job_candidates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    job_posting_id UUID NOT NULL REFERENCES public.job_postings(id),
    candidate_name VARCHAR(200) NOT NULL,
    email VARCHAR(200),
    phone VARCHAR(20),
    resume_url TEXT,
    experience_years NUMERIC(4,1),
    current_salary NUMERIC(12,2),
    expected_salary NUMERIC(12,2),
    status VARCHAR(30) NOT NULL DEFAULT 'applied', -- applied, shortlisted, interview_scheduled, interviewed, offered, hired, rejected
    interview_date TIMESTAMP WITH TIME ZONE,
    interview_notes TEXT,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Function to generate job code
CREATE OR REPLACE FUNCTION public.generate_job_code()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
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

-- Enable RLS
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_candidates ENABLE ROW LEVEL SECURITY;

-- RLS Policies (permissive for internal ERP)
CREATE POLICY "Allow all for authenticated users" ON public.attendance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.leave_types FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.leave_requests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.job_postings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON public.job_candidates FOR ALL USING (true) WITH CHECK (true);

-- Triggers for updated_at
CREATE TRIGGER update_attendance_updated_at BEFORE UPDATE ON public.attendance FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leave_requests_updated_at BEFORE UPDATE ON public.leave_requests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_job_postings_updated_at BEFORE UPDATE ON public.job_postings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_job_candidates_updated_at BEFORE UPDATE ON public.job_candidates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default leave types
INSERT INTO public.leave_types (code, name, days_per_year, is_paid) VALUES
('CL', 'Casual Leave', 12, true),
('SL', 'Sick Leave', 12, true),
('EL', 'Earned Leave', 15, true),
('LWP', 'Leave Without Pay', 0, false),
('ML', 'Maternity Leave', 180, true),
('PL', 'Paternity Leave', 15, true);