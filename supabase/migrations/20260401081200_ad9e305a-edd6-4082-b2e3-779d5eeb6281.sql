
-- rd_projects table
CREATE TABLE public.rd_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_number TEXT UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  current_stage TEXT NOT NULL DEFAULT 'idea',
  status TEXT NOT NULL DEFAULT 'active',
  priority TEXT DEFAULT 'medium',
  product_type TEXT,
  target_launch_date DATE,
  actual_launch_date DATE,
  department_id UUID REFERENCES public.production_departments(id),
  project_lead_id UUID REFERENCES public.app_users(id),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.rd_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to rd_projects" ON public.rd_projects FOR ALL USING (true) WITH CHECK (true);

-- rd_stage_gates table
CREATE TABLE public.rd_stage_gates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.rd_projects(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL,
  stage_order INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  approved_by UUID REFERENCES public.app_users(id),
  gate_checklist JSONB DEFAULT '[]'::jsonb,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.rd_stage_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to rd_stage_gates" ON public.rd_stage_gates FOR ALL USING (true) WITH CHECK (true);

-- rd_experiments table
CREATE TABLE public.rd_experiments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_number TEXT UNIQUE,
  project_id UUID REFERENCES public.rd_projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  objective TEXT,
  methodology TEXT,
  materials_used TEXT,
  parameters JSONB DEFAULT '{}'::jsonb,
  results TEXT,
  observations TEXT,
  conclusion TEXT,
  status TEXT NOT NULL DEFAULT 'planned',
  conducted_by UUID REFERENCES public.app_users(id),
  experiment_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.rd_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all access to rd_experiments" ON public.rd_experiments FOR ALL USING (true) WITH CHECK (true);

-- Auto-number for rd_projects
CREATE OR REPLACE FUNCTION public.generate_rd_project_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM rd_projects
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  NEW.project_number := 'RD-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_rd_project_number
BEFORE INSERT ON public.rd_projects
FOR EACH ROW
WHEN (NEW.project_number IS NULL)
EXECUTE FUNCTION public.generate_rd_project_number();

-- Auto-number for rd_experiments
CREATE OR REPLACE FUNCTION public.generate_rd_experiment_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM rd_experiments
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  NEW.experiment_number := 'EXP-' || v_year || '-' || LPAD(v_count::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_generate_rd_experiment_number
BEFORE INSERT ON public.rd_experiments
FOR EACH ROW
WHEN (NEW.experiment_number IS NULL)
EXECUTE FUNCTION public.generate_rd_experiment_number();

-- Updated_at triggers
CREATE TRIGGER update_rd_projects_updated_at
BEFORE UPDATE ON public.rd_projects
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_rd_experiments_updated_at
BEFORE UPDATE ON public.rd_experiments
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
