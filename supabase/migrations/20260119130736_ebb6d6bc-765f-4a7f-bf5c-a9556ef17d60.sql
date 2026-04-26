-- Add status column for approval workflow
ALTER TABLE public.labour_productivity_targets 
ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';

-- Add approved_by and approved_at columns
ALTER TABLE public.labour_productivity_targets 
ADD COLUMN approved_by UUID REFERENCES public.app_users(id),
ADD COLUMN approved_at TIMESTAMP WITH TIME ZONE;

-- Create index for status filtering
CREATE INDEX idx_labour_productivity_status ON public.labour_productivity_targets(status);