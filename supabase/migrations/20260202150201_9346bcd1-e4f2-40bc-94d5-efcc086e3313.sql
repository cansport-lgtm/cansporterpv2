-- Add custom_category column to fixed_assets table for user-defined categories
ALTER TABLE public.fixed_assets 
ADD COLUMN custom_category VARCHAR(100) NULL;