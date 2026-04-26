
CREATE TABLE IF NOT EXISTS public.hourly_production_processes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  target_per_hour numeric,
  unit text DEFAULT 'pcs',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.hourly_production_processes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to hourly_production_processes" ON public.hourly_production_processes FOR ALL TO anon USING (true) WITH CHECK (true);
