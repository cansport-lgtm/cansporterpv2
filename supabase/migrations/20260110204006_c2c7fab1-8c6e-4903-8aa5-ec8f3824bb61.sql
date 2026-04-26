
-- Drop existing policy
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON public.employee_loans;

-- Create policy for anon role (matching other ERP tables)
CREATE POLICY "Allow all operations for anon users" 
ON public.employee_loans 
FOR ALL 
TO anon 
USING (true) 
WITH CHECK (true);
