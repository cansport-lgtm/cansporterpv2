-- Add target_production column to production_entries table
ALTER TABLE public.production_entries 
ADD COLUMN target_production integer NOT NULL DEFAULT 0;