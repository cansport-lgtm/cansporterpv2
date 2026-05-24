ALTER TABLE public.crm_launch_milestones
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;