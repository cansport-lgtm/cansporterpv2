-- ============================================================
-- Accounting Module — Phase 3b: WIP → FG → COGS chain
-- Adds standard_cost on products for COGS calculation at dispatch.
-- ============================================================

-- 1) Product standard cost (per dozen, PKR)
-- Used by postCOGSForDispatch to compute Dr COGS / Cr FG amount.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS standard_cost NUMERIC(15,4) DEFAULT 0;

COMMENT ON COLUMN public.products.standard_cost IS
  'Standard cost per dozen (PKR). Drives auto-COGS-at-sale and FG inventory valuation.';

-- 2) No new default-account slots — uses Phase 3a slots:
--    wip_inventory (1131), finished_goods_inventory (1132), cogs (5100)
--    Already seeded by Phase 3a migration.

-- 3) Relax source_reference_id type from UUID to TEXT
-- Phase 3a's consumption helper + Phase 3b's production output helper both use date
-- strings (e.g. '2026-05-15') as the source key for daily-batched vouchers. UUID
-- column would reject these. TEXT is backwards-compatible — existing UUID values
-- remain valid as text.
ALTER TABLE public.accounting_vouchers ALTER COLUMN source_reference_id TYPE TEXT USING source_reference_id::text;
