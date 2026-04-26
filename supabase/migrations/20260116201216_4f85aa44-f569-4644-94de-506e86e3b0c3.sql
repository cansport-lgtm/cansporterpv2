-- Add work_type and mph columns to labour_productivity_targets
ALTER TABLE public.labour_productivity_targets 
ADD COLUMN work_type TEXT NOT NULL DEFAULT 'full_day' CHECK (work_type IN ('full_day', 'half_day')),
ADD COLUMN mph NUMERIC(5,2) GENERATED ALWAYS AS (
  CASE 
    WHEN work_type = 'full_day' THEN 12
    WHEN work_type = 'half_day' THEN 6
    ELSE 0
  END
) STORED;