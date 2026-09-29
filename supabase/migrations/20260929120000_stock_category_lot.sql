-- Add "lot" (Lot Item) to the planning_items stock categories.
ALTER TABLE public.planning_items
  DROP CONSTRAINT IF EXISTS planning_items_stock_category_check;

ALTER TABLE public.planning_items
  ADD CONSTRAINT planning_items_stock_category_check
    CHECK (stock_category IN ('standard', 'cpa', 'leak', 'rejection', 'lot'));

COMMENT ON COLUMN public.planning_items.stock_category IS
  'Stock category of the item: standard (sellable finished goods), cpa (held by Quality for mismatched parameters), leak, rejection, or lot (lot items). Non-standard categories are valued separately from the finished-goods headline.';
