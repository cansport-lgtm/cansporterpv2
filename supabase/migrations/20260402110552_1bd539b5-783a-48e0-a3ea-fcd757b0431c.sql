
-- Create qa_process_instructions table
CREATE TABLE public.qa_process_instructions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  process_id UUID NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL DEFAULT 1,
  title TEXT NOT NULL,
  description TEXT,
  instruction_type TEXT NOT NULL DEFAULT 'step',
  image_url TEXT,
  video_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.qa_process_instructions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for anon" ON public.qa_process_instructions
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- Create storage bucket for instruction images/documents
INSERT INTO storage.buckets (id, name, public) VALUES ('qa-instructions', 'qa-instructions', true);

-- Storage RLS policies
CREATE POLICY "Allow public read qa-instructions" ON storage.objects
  FOR SELECT TO anon USING (bucket_id = 'qa-instructions');

CREATE POLICY "Allow anon upload qa-instructions" ON storage.objects
  FOR INSERT TO anon WITH CHECK (bucket_id = 'qa-instructions');

CREATE POLICY "Allow anon update qa-instructions" ON storage.objects
  FOR UPDATE TO anon USING (bucket_id = 'qa-instructions');

CREATE POLICY "Allow anon delete qa-instructions" ON storage.objects
  FOR DELETE TO anon USING (bucket_id = 'qa-instructions');
