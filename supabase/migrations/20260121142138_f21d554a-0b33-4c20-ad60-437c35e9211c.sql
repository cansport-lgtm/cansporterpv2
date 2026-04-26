-- Add assigned_to column to qa_daily_plan_items for user-level assignment
ALTER TABLE public.qa_daily_plan_items 
ADD COLUMN assigned_to uuid REFERENCES public.app_users(id);

-- Also add to template items so templates can have default assignments
ALTER TABLE public.qa_plan_template_items 
ADD COLUMN assigned_to uuid REFERENCES public.app_users(id);

-- Create index for efficient querying by assigned user
CREATE INDEX idx_qa_daily_plan_items_assigned_to ON public.qa_daily_plan_items(assigned_to);
