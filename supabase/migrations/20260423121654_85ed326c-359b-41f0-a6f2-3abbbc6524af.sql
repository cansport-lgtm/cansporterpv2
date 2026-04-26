ALTER TABLE public.labour_productivity_edit_requests
  ADD COLUMN IF NOT EXISTS current_mph numeric NULL,
  ADD COLUMN IF NOT EXISTS requested_mph numeric NULL;