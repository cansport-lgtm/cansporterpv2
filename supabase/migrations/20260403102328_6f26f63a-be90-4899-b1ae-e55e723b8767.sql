
CREATE TABLE public.public_holidays (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  holiday_date DATE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(holiday_date)
);

ALTER TABLE public.public_holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view public holidays"
  ON public.public_holidays FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage public holidays"
  ON public.public_holidays FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
