-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Admins can manage qa_processes" ON public.qa_processes;
DROP POLICY IF EXISTS "Admins can manage qa_process_parameters" ON public.qa_process_parameters;

-- Create simpler policies that work with custom auth
CREATE POLICY "Authenticated users can manage qa_processes" 
ON public.qa_processes FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage qa_process_parameters" 
ON public.qa_process_parameters FOR ALL TO authenticated USING (true) WITH CHECK (true);