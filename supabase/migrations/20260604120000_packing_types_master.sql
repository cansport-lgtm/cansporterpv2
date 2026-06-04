CREATE TABLE IF NOT EXISTS public.packing_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  dozens numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.packing_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.packing_types FOR SELECT USING (true);
CREATE POLICY "Full access" ON public.packing_types FOR ALL USING (true) WITH CHECK (true);

INSERT INTO public.packing_types (label, dozens, sort_order) VALUES
 ('12 Dz CTN',12,1),('20 Dz Bag',20,2),('60 Dz Bag',60,3),
 ('20 Dz CTN',20,4),('6 Dz CTN',6,5),('25 Dz Bag',25,6),('15 Dz CTN',15,7);
