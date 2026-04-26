
CREATE TABLE public.labour_mph_authorized (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id UUID REFERENCES public.production_departments(id) ON DELETE CASCADE NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  authorized_mph NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(department_id, month, year)
);

ALTER TABLE public.labour_mph_authorized ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to labour_mph_authorized"
ON public.labour_mph_authorized
FOR ALL
TO anon, authenticated
USING (true)
WITH CHECK (true);

CREATE TRIGGER update_labour_mph_authorized_updated_at
BEFORE UPDATE ON public.labour_mph_authorized
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
