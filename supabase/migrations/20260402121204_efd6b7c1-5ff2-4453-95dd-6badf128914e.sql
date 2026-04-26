
CREATE TABLE public.qa_process_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id UUID NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
  standard_title TEXT NOT NULL,
  standard_description TEXT,
  standard_type TEXT DEFAULT 'specification',
  target_value TEXT,
  tolerance_range TEXT,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.qa_process_standards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access for anon" ON public.qa_process_standards FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE TRIGGER update_qa_process_standards_updated_at
  BEFORE UPDATE ON public.qa_process_standards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
