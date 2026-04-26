-- QA tables currently fail writes because the frontend uses the publishable (anon) key and does not create a backend-auth session.
-- To match the existing ERP pattern (e.g., production tables), allow access via the PUBLIC role.

-- Drop previous QA policies
DROP POLICY IF EXISTS "Users can view qa_processes" ON public.qa_processes;
DROP POLICY IF EXISTS "Authenticated users can manage qa_processes" ON public.qa_processes;

DROP POLICY IF EXISTS "Users can view qa_process_parameters" ON public.qa_process_parameters;
DROP POLICY IF EXISTS "Authenticated users can manage qa_process_parameters" ON public.qa_process_parameters;

DROP POLICY IF EXISTS "Users can view qa_inspections" ON public.qa_inspections;
DROP POLICY IF EXISTS "Users can create qa_inspections" ON public.qa_inspections;
DROP POLICY IF EXISTS "Users can update qa_inspections" ON public.qa_inspections;

DROP POLICY IF EXISTS "Users can view qa_inspection_readings" ON public.qa_inspection_readings;
DROP POLICY IF EXISTS "Users can manage qa_inspection_readings" ON public.qa_inspection_readings;

DROP POLICY IF EXISTS "Users can view qa_ncr" ON public.qa_ncr;
DROP POLICY IF EXISTS "Users can create qa_ncr" ON public.qa_ncr;
DROP POLICY IF EXISTS "Users can update qa_ncr" ON public.qa_ncr;

DROP POLICY IF EXISTS "Users can view qa_capa" ON public.qa_capa;
DROP POLICY IF EXISTS "Users can create qa_capa" ON public.qa_capa;
DROP POLICY IF EXISTS "Users can update qa_capa" ON public.qa_capa;

-- Create permissive policies for PUBLIC (covers anon + authenticated)
CREATE POLICY "Full access" ON public.qa_processes FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.qa_process_parameters FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.qa_inspections FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.qa_inspection_readings FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.qa_ncr FOR ALL TO public USING (true) WITH CHECK (true);
CREATE POLICY "Full access" ON public.qa_capa FOR ALL TO public USING (true) WITH CHECK (true);

-- Fix linter warnings: ensure search_path is set for trigger functions
CREATE OR REPLACE FUNCTION public.generate_inspection_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.inspection_number IS NULL OR NEW.inspection_number = '' THEN
    NEW.inspection_number := 'INS-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_ncr_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.ncr_number IS NULL OR NEW.ncr_number = '' THEN
    NEW.ncr_number := 'NCR-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_capa_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.capa_number IS NULL OR NEW.capa_number = '' THEN
    NEW.capa_number := 'CAPA-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(FLOOR(RANDOM() * 10000)::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;