
CREATE TABLE public.qa_instruction_acknowledgements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.qa_processes(id) ON DELETE CASCADE,
  acknowledgement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, process_id, acknowledgement_date)
);

ALTER TABLE public.qa_instruction_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon full access on qa_instruction_acknowledgements"
ON public.qa_instruction_acknowledgements
FOR ALL
TO anon
USING (true)
WITH CHECK (true);
