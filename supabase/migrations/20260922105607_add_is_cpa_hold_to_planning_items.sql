ALTER TABLE public.planning_items
  ADD COLUMN is_cpa_hold boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.planning_items.is_cpa_hold IS
  'True for items representing stock held by Quality (CPA / mismatched parameter), tracked separately from normal sellable finished-goods stock.';
