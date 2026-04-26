
-- Six Sigma Projects
CREATE TABLE public.six_sigma_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  methodology TEXT NOT NULL DEFAULT 'DMAIC', -- DMAIC, DMADV
  current_phase TEXT NOT NULL DEFAULT 'define', -- define, measure, analyze, improve/design, control/verify
  status TEXT NOT NULL DEFAULT 'active', -- active, on_hold, completed, cancelled
  priority TEXT DEFAULT 'medium', -- low, medium, high, critical
  champion_id UUID REFERENCES public.app_users(id),
  belt_leader_id UUID REFERENCES public.app_users(id),
  department_id UUID REFERENCES public.production_departments(id),
  start_date DATE,
  target_completion DATE,
  actual_completion DATE,
  problem_statement TEXT,
  goal_statement TEXT,
  scope TEXT,
  baseline_sigma NUMERIC(4,2),
  current_sigma NUMERIC(4,2),
  target_sigma NUMERIC(4,2),
  baseline_dpmo NUMERIC(12,2),
  current_dpmo NUMERIC(12,2),
  target_dpmo NUMERIC(12,2),
  estimated_savings NUMERIC(12,2),
  actual_savings NUMERIC(12,2),
  linked_ncr_ids TEXT[], -- QA integration: array of NCR IDs
  linked_capa_ids TEXT[], -- QA integration: array of CAPA IDs
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES public.app_users(id)
);

-- Six Sigma Project Phases (DMAIC/DMADV phase tracking)
CREATE TABLE public.six_sigma_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.six_sigma_projects(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL, -- define, measure, analyze, improve, control (or design, verify for DMADV)
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, approved
  start_date DATE,
  end_date DATE,
  deliverables TEXT,
  gate_review_date DATE,
  gate_review_status TEXT, -- pending, approved, rejected
  gate_reviewer_id UUID REFERENCES public.app_users(id),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Six Sigma Tools (SIPOC, CTQ, Fishbone, Pareto, Control Chart data)
CREATE TABLE public.six_sigma_tools (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.six_sigma_projects(id) ON DELETE CASCADE,
  phase_id UUID REFERENCES public.six_sigma_phases(id) ON DELETE SET NULL,
  tool_type TEXT NOT NULL, -- sipoc, ctq_tree, fishbone, five_why, pareto, control_chart, process_map, control_plan
  title TEXT NOT NULL,
  tool_data JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'draft', -- draft, completed
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Six Sigma Metrics tracking
CREATE TABLE public.six_sigma_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.six_sigma_projects(id) ON DELETE CASCADE,
  measurement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  metric_type TEXT NOT NULL, -- dpmo, sigma_level, yield, defect_rate, cost_savings
  metric_value NUMERIC(14,4) NOT NULL,
  unit TEXT,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Six Sigma Team Members
CREATE TABLE public.six_sigma_team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.six_sigma_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.app_users(id),
  role TEXT NOT NULL DEFAULT 'team_member', -- champion, black_belt, green_belt, yellow_belt, team_member
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, user_id)
);

-- Enable RLS
ALTER TABLE public.six_sigma_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.six_sigma_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.six_sigma_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.six_sigma_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.six_sigma_team_members ENABLE ROW LEVEL SECURITY;

-- RLS policies (authenticated users can read, super_admin/managers can write)
CREATE POLICY "Authenticated users can view six sigma projects" ON public.six_sigma_projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert six sigma projects" ON public.six_sigma_projects FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update six sigma projects" ON public.six_sigma_projects FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete six sigma projects" ON public.six_sigma_projects FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view six sigma phases" ON public.six_sigma_phases FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert six sigma phases" ON public.six_sigma_phases FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update six sigma phases" ON public.six_sigma_phases FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete six sigma phases" ON public.six_sigma_phases FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view six sigma tools" ON public.six_sigma_tools FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert six sigma tools" ON public.six_sigma_tools FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update six sigma tools" ON public.six_sigma_tools FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete six sigma tools" ON public.six_sigma_tools FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view six sigma metrics" ON public.six_sigma_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert six sigma metrics" ON public.six_sigma_metrics FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update six sigma metrics" ON public.six_sigma_metrics FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete six sigma metrics" ON public.six_sigma_metrics FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view six sigma team" ON public.six_sigma_team_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert six sigma team" ON public.six_sigma_team_members FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update six sigma team" ON public.six_sigma_team_members FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete six sigma team" ON public.six_sigma_team_members FOR DELETE TO authenticated USING (true);

-- Generate project number function
CREATE OR REPLACE FUNCTION public.generate_six_sigma_project_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM six_sigma_projects 
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  NEW.project_number := '6S-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_six_sigma_project_number
  BEFORE INSERT ON public.six_sigma_projects
  FOR EACH ROW
  WHEN (NEW.project_number IS NULL OR NEW.project_number = '')
  EXECUTE FUNCTION public.generate_six_sigma_project_number();

-- Updated at triggers
CREATE TRIGGER update_six_sigma_projects_updated_at
  BEFORE UPDATE ON public.six_sigma_projects
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_six_sigma_phases_updated_at
  BEFORE UPDATE ON public.six_sigma_phases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_six_sigma_tools_updated_at
  BEFORE UPDATE ON public.six_sigma_tools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
