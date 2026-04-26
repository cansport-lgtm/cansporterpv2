-- Drop the existing unique constraint that prevents multiple entries per day
ALTER TABLE public.labour_productivity_targets 
DROP CONSTRAINT IF EXISTS labour_productivity_targets_employee_id_target_date_shift_key;

-- Add a new unique constraint that allows multiple entries per day but prevents exact duplicates
-- (same employee, date, department, and process)
ALTER TABLE public.labour_productivity_targets 
ADD CONSTRAINT labour_productivity_targets_unique_entry 
UNIQUE (employee_id, target_date, department_id, process_id);