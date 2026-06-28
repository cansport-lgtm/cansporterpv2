-- Return-claim tracking: parcels the courier marked returned but never delivered
-- back (lost in return) become claim candidates after an aging threshold. These
-- columns persist the claim lifecycle against the courier.

ALTER TABLE public.online_orders
  ADD COLUMN IF NOT EXISTS claim_status text,        -- null | filed | recovered | written_off
  ADD COLUMN IF NOT EXISTS claim_filed_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_notes text;

ALTER TABLE public.online_orders
  ADD CONSTRAINT online_orders_claim_status_chk
  CHECK (claim_status IS NULL OR claim_status IN ('filed','recovered','written_off'));
