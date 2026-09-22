ALTER TABLE public.planning_items
  ADD COLUMN stock_category text NOT NULL DEFAULT 'standard'
    CHECK (stock_category IN ('standard', 'cpa', 'leak', 'rejection'));

UPDATE public.planning_items
  SET stock_category = 'cpa'
  WHERE is_cpa_hold;

ALTER TABLE public.planning_items DROP COLUMN is_cpa_hold;

COMMENT ON COLUMN public.planning_items.stock_category IS
  'Stock category of the item: standard (sellable finished goods), cpa (held by Quality for mismatched parameters), leak, or rejection. Non-standard categories are valued separately from the finished-goods headline.';
