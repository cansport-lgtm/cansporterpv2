-- Add in-process material categories "cutting_kapra" (Cutting Kapra) and "compounds" (Compounds)
-- to the planning_items stock categories.
ALTER TABLE public.planning_items
  DROP CONSTRAINT IF EXISTS planning_items_stock_category_check;

ALTER TABLE public.planning_items
  ADD CONSTRAINT planning_items_stock_category_check
    CHECK (stock_category IN ('standard', 'final_ball', 'cpa', 'leak', 'rejection', 'lot', 'cutting_kapra', 'compounds'));

COMMENT ON COLUMN public.planning_items.stock_category IS
  'Stock category of the item: standard (sellable finished goods), final_ball (sellable finished balls), cpa (held by Quality for mismatched parameters), leak, rejection, lot (lot items), cutting_kapra (cut fabric, in-process) or compounds (in-process). Standard and final_ball count in the finished-goods headline; cpa, leak, rejection and lot are valued separately as held stock; cutting_kapra and compounds are in-process material, neither sellable nor held.';
