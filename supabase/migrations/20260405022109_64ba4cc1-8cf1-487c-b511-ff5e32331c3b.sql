
CREATE TABLE public.hourly_production_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date date NOT NULL,
  hour_slot integer NOT NULL,
  process_name text NOT NULL,
  worker_name text,
  quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'pcs',
  remarks text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX hourly_production_entries_unique_idx ON public.hourly_production_entries (entry_date, hour_slot, process_name, COALESCE(worker_name, ''));

ALTER TABLE public.hourly_production_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to hourly_production_entries" ON public.hourly_production_entries FOR ALL TO anon USING (true) WITH CHECK (true);
