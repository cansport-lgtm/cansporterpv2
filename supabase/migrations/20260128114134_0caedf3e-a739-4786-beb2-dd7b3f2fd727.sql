-- Add overtime_amount column to labour_productivity_targets table
ALTER TABLE public.labour_productivity_targets
ADD COLUMN overtime_amount numeric DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN public.labour_productivity_targets.overtime_amount IS 'Overtime amount for the day in PKR';