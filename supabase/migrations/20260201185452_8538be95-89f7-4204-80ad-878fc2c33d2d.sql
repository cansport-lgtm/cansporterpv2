-- Add threshold_inventory column to planning_items table
ALTER TABLE public.planning_items 
ADD COLUMN threshold_inventory numeric DEFAULT 0;