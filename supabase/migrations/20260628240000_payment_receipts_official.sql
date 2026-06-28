-- Store PostEx's official CPR statement figures (imported from the CPR export) so
-- the receipt matches PostEx exactly and variance vs our computed/orders is shown.
ALTER TABLE public.payment_receipts
  ADD COLUMN IF NOT EXISTS statement_date date,
  ADD COLUMN IF NOT EXISTS official_net numeric,
  ADD COLUMN IF NOT EXISTS delivered_count integer,
  ADD COLUMN IF NOT EXISTS delivered_cod numeric,
  ADD COLUMN IF NOT EXISTS returned_count integer,
  ADD COLUMN IF NOT EXISTS returned_cod numeric,
  ADD COLUMN IF NOT EXISTS shipping numeric,
  ADD COLUMN IF NOT EXISTS gst numeric,
  ADD COLUMN IF NOT EXISTS wh_income numeric,
  ADD COLUMN IF NOT EXISTS wh_sales numeric,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;
