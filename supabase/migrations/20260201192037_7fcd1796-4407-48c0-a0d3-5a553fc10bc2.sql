-- Add unit column to planning_items table
ALTER TABLE public.planning_items 
ADD COLUMN unit character varying DEFAULT 'dzns';