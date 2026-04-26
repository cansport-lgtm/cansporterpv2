-- Create table for daily inspection targets per process
CREATE TABLE public.qa_inspection_targets (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  target_date DATE NOT NULL DEFAULT CURRENT_DATE,
  process_id UUID NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
  target_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(target_date, process_id)
);

-- Enable Row Level Security
ALTER TABLE public.qa_inspection_targets ENABLE ROW LEVEL SECURITY;

-- Create policy for full access
CREATE POLICY "Full access for qa_inspection_targets"
ON public.qa_inspection_targets
FOR ALL
USING (true)
WITH CHECK (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_qa_inspection_targets_updated_at
BEFORE UPDATE ON public.qa_inspection_targets
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();