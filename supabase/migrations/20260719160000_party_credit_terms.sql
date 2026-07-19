-- Per-party credit terms for cash-flow forecasting and credit control.
--
-- credit_days:  expected settlement terms for this party. NULL means "no
--               specific terms" — the Cash Flow Forecast falls back to its
--               page-level default. Applies to customers (collection terms)
--               and suppliers (payment terms) alike.
-- credit_limit: maximum outstanding balance allowed for this party (Rs).
--               NULL or 0 means no limit is enforced/flagged.
ALTER TABLE public.accounting_parties
  ADD COLUMN IF NOT EXISTS credit_days INTEGER CHECK (credit_days >= 0),
  ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(15,2) CHECK (credit_limit >= 0);
