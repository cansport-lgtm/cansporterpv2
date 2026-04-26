-- Performance Module Tables

-- Review Cycles (e.g., Q1 2025 Review, Annual Review 2025)
CREATE TABLE public.performance_review_cycles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'closed')),
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- KPI Library (master list of KPIs)
CREATE TABLE public.performance_kpis (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50), -- e.g., Productivity, Quality, Attendance, Behavior
  measurement_type VARCHAR(20) NOT NULL DEFAULT 'numeric' CHECK (measurement_type IN ('numeric', 'percentage', 'rating', 'boolean')),
  target_direction VARCHAR(10) DEFAULT 'higher' CHECK (target_direction IN ('higher', 'lower', 'exact')),
  min_value DECIMAL(10,2),
  max_value DECIMAL(10,2),
  unit VARCHAR(20), -- e.g., %, hrs, pieces
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Employee Goals (KPIs assigned to employees for a review cycle)
CREATE TABLE public.performance_goals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  review_cycle_id UUID NOT NULL REFERENCES public.performance_review_cycles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  kpi_id UUID NOT NULL REFERENCES public.performance_kpis(id),
  target_value DECIMAL(10,2) NOT NULL,
  weight DECIMAL(5,2) DEFAULT 1.0, -- Weight for weighted average scoring
  actual_value DECIMAL(10,2),
  score DECIMAL(5,2), -- Calculated score out of 100
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'achieved', 'not_achieved', 'partially_achieved')),
  remarks TEXT,
  assigned_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(review_cycle_id, employee_id, kpi_id)
);

-- Performance Reviews (final review summary for an employee in a cycle)
CREATE TABLE public.performance_reviews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  review_cycle_id UUID NOT NULL REFERENCES public.performance_review_cycles(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES public.app_users(id),
  overall_score DECIMAL(5,2), -- Weighted average of all goal scores
  overall_rating VARCHAR(20), -- e.g., Excellent, Good, Satisfactory, Needs Improvement
  strengths TEXT,
  areas_for_improvement TEXT,
  reviewer_comments TEXT,
  employee_comments TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'reviewed', 'acknowledged', 'closed')),
  reviewed_at TIMESTAMP WITH TIME ZONE,
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(review_cycle_id, employee_id)
);

-- Enable Row Level Security
ALTER TABLE public.performance_review_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies (permissive for authenticated users - role logic handled at app level)
CREATE POLICY "Allow all for performance_review_cycles" ON public.performance_review_cycles
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for performance_kpis" ON public.performance_kpis
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for performance_goals" ON public.performance_goals
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for performance_reviews" ON public.performance_reviews
  FOR ALL USING (true) WITH CHECK (true);

-- Function to generate KPI code
CREATE OR REPLACE FUNCTION public.generate_kpi_code()
RETURNS TEXT AS $$
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
$$ LANGUAGE plpgsql SET search_path = public;

-- Trigger for updated_at
CREATE TRIGGER update_performance_review_cycles_updated_at
  BEFORE UPDATE ON public.performance_review_cycles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_performance_kpis_updated_at
  BEFORE UPDATE ON public.performance_kpis
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_performance_goals_updated_at
  BEFORE UPDATE ON public.performance_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_performance_reviews_updated_at
  BEFORE UPDATE ON public.performance_reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();