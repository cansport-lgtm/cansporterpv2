-- Add process_id column to labour_productivity_targets
ALTER TABLE public.labour_productivity_targets 
ADD COLUMN process_id UUID REFERENCES public.qa_processes(id);

-- Add index for better query performance
CREATE INDEX idx_labour_productivity_targets_process_id ON public.labour_productivity_targets(process_id);