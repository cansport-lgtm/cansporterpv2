
CREATE TABLE public.labour_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.labour_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all select on labour_categories" ON public.labour_categories FOR SELECT USING (true);
CREATE POLICY "Allow all insert on labour_categories" ON public.labour_categories FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow all update on labour_categories" ON public.labour_categories FOR UPDATE USING (true);
CREATE POLICY "Allow all delete on labour_categories" ON public.labour_categories FOR DELETE USING (true);

CREATE TRIGGER update_labour_categories_updated_at BEFORE UPDATE ON public.labour_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
