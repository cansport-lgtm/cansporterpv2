ALTER TABLE public.daily_stock_closing
  ADD COLUMN IF NOT EXISTS entered_quantity numeric,
  ADD COLUMN IF NOT EXISTS multiplier numeric DEFAULT 1;

UPDATE public.daily_stock_closing
  SET entered_quantity = closing_quantity, multiplier = 1
  WHERE entered_quantity IS NULL;