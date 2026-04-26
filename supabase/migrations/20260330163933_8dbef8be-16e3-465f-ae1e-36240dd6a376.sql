
CREATE TABLE public.online_platforms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.online_platforms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated read" ON public.online_platforms FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated insert" ON public.online_platforms FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated update" ON public.online_platforms FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow authenticated delete" ON public.online_platforms FOR DELETE TO authenticated USING (true);

INSERT INTO public.online_platforms (name, code) VALUES
  ('Amazon', 'AMZ'),
  ('Flipkart', 'FLK'),
  ('Meesho', 'MSH'),
  ('Shopify', 'SHP'),
  ('Website', 'WEB'),
  ('Instagram', 'INS'),
  ('Other', 'OTH');
