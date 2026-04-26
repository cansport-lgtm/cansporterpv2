ALTER TABLE public.labour_productivity_targets
  ADD COLUMN IF NOT EXISTS check_in  time NULL,
  ADD COLUMN IF NOT EXISTS check_out time NULL;