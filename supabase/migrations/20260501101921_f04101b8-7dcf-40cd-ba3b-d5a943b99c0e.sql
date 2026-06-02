CREATE TABLE public.hourly_production_losses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entry_date date NOT NULL,
  hour_slot integer NOT NULL,
  department_id uuid REFERENCES public.production_departments(id) ON DELETE SET NULL,
  process_name text NOT NULL,
  reason_id uuid REFERENCES public.downtime_reasons(id) ON DELETE SET NULL,
  lost_minutes numeric NOT NULL DEFAULT 0,
  lost_quantity numeric NOT NULL DEFAULT 0,
  unit text DEFAULT 'pcs',
  remarks text,
  created_by uuid REFERENCES public.app_users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX hourly_production_losses_date_dept_idx ON public.hourly_production_losses (entry_date, department_id);

ALTER TABLE public.hourly_production_losses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to hourly_production_losses"
  ON public.hourly_production_losses
  FOR ALL TO anon
  USING (true) WITH CHECK (true);

CREATE TRIGGER update_hourly_production_losses_updated_at
  BEFORE UPDATE ON public.hourly_production_losses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();