
CREATE TABLE public.consumption_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.consumption_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to consumption_categories" ON public.consumption_categories FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_consumption_categories_updated_at
  BEFORE UPDATE ON public.consumption_categories
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed existing categories from raw materials
INSERT INTO public.consumption_categories (name, code)
SELECT DISTINCT category, UPPER(REPLACE(category, ' ', '_'))
FROM public.consumption_raw_materials
WHERE category IS NOT NULL AND category != ''
ON CONFLICT (name) DO NOTHING;
