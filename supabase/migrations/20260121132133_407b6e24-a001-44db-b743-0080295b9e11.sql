-- Create table for Quality Plan Templates
CREATE TABLE public.qa_plan_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for Quality Plan Template Items
CREATE TABLE public.qa_plan_template_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.qa_plan_templates(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.production_departments(id),
  process_id UUID REFERENCES public.qa_processes(id),
  grade_id UUID REFERENCES public.grades(id),
  target_inspections INTEGER NOT NULL DEFAULT 1,
  priority VARCHAR DEFAULT 'medium',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create table for Daily Quality Plans
CREATE TABLE public.qa_daily_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_date DATE NOT NULL DEFAULT CURRENT_DATE,
  template_id UUID REFERENCES public.qa_plan_templates(id),
  shift VARCHAR DEFAULT 'Day',
  status VARCHAR NOT NULL DEFAULT 'draft',
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(plan_date, shift)
);

-- Create table for Daily Quality Plan Items
CREATE TABLE public.qa_daily_plan_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES public.qa_daily_plans(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.production_departments(id),
  process_id UUID REFERENCES public.qa_processes(id),
  grade_id UUID REFERENCES public.grades(id),
  target_inspections INTEGER NOT NULL DEFAULT 1,
  completed_inspections INTEGER NOT NULL DEFAULT 0,
  priority VARCHAR DEFAULT 'medium',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.qa_plan_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_plan_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_daily_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_daily_plan_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for all tables
CREATE POLICY "Full access for qa_plan_templates" ON public.qa_plan_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for qa_plan_template_items" ON public.qa_plan_template_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for qa_daily_plans" ON public.qa_daily_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Full access for qa_daily_plan_items" ON public.qa_daily_plan_items FOR ALL USING (true) WITH CHECK (true);

-- Create trigger for updated_at on all tables
CREATE TRIGGER update_qa_plan_templates_updated_at BEFORE UPDATE ON public.qa_plan_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_qa_daily_plans_updated_at BEFORE UPDATE ON public.qa_daily_plans FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_qa_daily_plan_items_updated_at BEFORE UPDATE ON public.qa_daily_plan_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for performance
CREATE INDEX idx_qa_daily_plans_date ON public.qa_daily_plans(plan_date);
CREATE INDEX idx_qa_daily_plan_items_plan_id ON public.qa_daily_plan_items(plan_id);
CREATE INDEX idx_qa_plan_template_items_template_id ON public.qa_plan_template_items(template_id);