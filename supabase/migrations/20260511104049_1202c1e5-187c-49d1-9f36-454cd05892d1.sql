
CREATE TABLE public.sales_cities (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sales_areas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  city_id uuid REFERENCES public.sales_cities(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name, city_id)
);

ALTER TABLE public.sales_cities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon all sales_cities" ON public.sales_cities FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all sales_cities" ON public.sales_cities FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "anon all sales_areas" ON public.sales_areas FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all sales_areas" ON public.sales_areas FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_sales_cities_updated BEFORE UPDATE ON public.sales_cities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_sales_areas_updated BEFORE UPDATE ON public.sales_areas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.sales_cities (name) VALUES ('Karachi'),('Lahore'),('Rawalpindi'),('Hyderabad'),('Sukkur')
  ON CONFLICT (name) DO NOTHING;
