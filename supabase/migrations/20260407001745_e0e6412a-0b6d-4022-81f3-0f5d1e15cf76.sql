
ALTER TABLE public.qa_processes ADD COLUMN IF NOT EXISTS requires_inspection_tag boolean DEFAULT false;
ALTER TABLE public.qa_inspections ADD COLUMN IF NOT EXISTS tag_tracking_number text;
