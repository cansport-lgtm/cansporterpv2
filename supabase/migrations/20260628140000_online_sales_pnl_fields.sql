-- Phase 4: fields needed for true profit / P&L
--
-- online_items.price is the selling price; cost_price enables COGS & margin.
-- online_platforms.commission_pct lets the P&L deduct marketplace commission.

ALTER TABLE public.online_items
  ADD COLUMN IF NOT EXISTS cost_price NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.online_platforms
  ADD COLUMN IF NOT EXISTS commission_pct NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.online_items
  ADD CONSTRAINT online_items_cost_price_chk CHECK (cost_price >= 0);

ALTER TABLE public.online_platforms
  ADD CONSTRAINT online_platforms_commission_pct_chk CHECK (commission_pct >= 0 AND commission_pct <= 100);
