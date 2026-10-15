-- Add "final_ball" (Standard (Final Ball)) to the planning_items stock categories.
ALTER TABLE public.planning_items
  DROP CONSTRAINT IF EXISTS planning_items_stock_category_check;

ALTER TABLE public.planning_items
  ADD CONSTRAINT planning_items_stock_category_check
    CHECK (stock_category IN ('standard', 'final_ball', 'cpa', 'leak', 'rejection', 'lot'));

COMMENT ON COLUMN public.planning_items.stock_category IS
  'Stock category of the item: standard (sellable finished goods), final_ball (sellable finished balls), cpa (held by Quality for mismatched parameters), leak, rejection, or lot (lot items). Standard and final_ball count in the finished-goods headline; the other categories are valued separately as held stock.';
