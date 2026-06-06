-- Add a transportation / freight cost field to the purchase invoice (GRN).
-- It is added on top of the line-item subtotal to form the GRN total_amount.

ALTER TABLE public.goods_receipt_notes
  ADD COLUMN IF NOT EXISTS transportation_cost NUMERIC(12, 2) NOT NULL DEFAULT 0;
