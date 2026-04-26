
ALTER TABLE public.labour_productivity_edit_requests
  ADD COLUMN IF NOT EXISTS requested_standard_target numeric NULL,
  ADD COLUMN IF NOT EXISTS requested_process_id uuid NULL,
  ADD COLUMN IF NOT EXISTS requested_department_id uuid NULL,
  ADD COLUMN IF NOT EXISTS requested_employee_id uuid NULL,
  ADD COLUMN IF NOT EXISTS requested_entry_date date NULL,
  ADD COLUMN IF NOT EXISTS current_standard_target numeric NULL,
  ADD COLUMN IF NOT EXISTS current_process_id uuid NULL,
  ADD COLUMN IF NOT EXISTS current_department_id uuid NULL,
  ADD COLUMN IF NOT EXISTS current_employee_id uuid NULL,
  ADD COLUMN IF NOT EXISTS current_entry_date date NULL;

ALTER TABLE public.labour_productivity_edit_requests
  ALTER COLUMN current_actual_quantity DROP NOT NULL,
  ALTER COLUMN requested_actual_quantity DROP NOT NULL;
