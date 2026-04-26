-- Make plan_id nullable to allow standalone planning items
ALTER TABLE public.production_planning_items 
ALTER COLUMN plan_id DROP NOT NULL;