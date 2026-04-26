-- Create planning_items table for department-wise items unique to production planning
CREATE TABLE public.planning_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(department_id, code)
);

-- Enable RLS
ALTER TABLE public.planning_items ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Full access for planning_items" ON public.planning_items FOR ALL USING (true) WITH CHECK (true);

-- Add planning_item_id to production_planning_items
ALTER TABLE public.production_planning_items 
ADD COLUMN planning_item_id UUID REFERENCES public.planning_items(id);

-- Create indexes with unique names
CREATE INDEX idx_planning_items_dept ON public.planning_items(department_id);
CREATE INDEX idx_prod_plan_items_item ON public.production_planning_items(planning_item_id);