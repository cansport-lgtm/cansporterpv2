-- ============================================================================
-- Drop products.customer_id
-- ----------------------------------------------------------------------------
-- Second half of 20261003150000_customer_sku_owner_party.sql. Customer SKUs
-- are owned by products.customer_party_id (accounts-receivable party); the
-- sales-customer link is no longer read by the UI. Apply only after the front
-- end that selects customer_party_id is live.
-- ============================================================================

DROP INDEX IF EXISTS public.idx_products_customer;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS customer_id;
