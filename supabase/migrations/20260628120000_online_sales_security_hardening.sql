-- Phase 1: Online Sales security hardening (scoped)
--
-- Context: this app has no Supabase Auth; every request hits the database as the
-- public `anon` role, so per-user RLS is not achievable without an app-wide auth
-- migration (tracked separately). This migration reduces blast radius without
-- breaking the anon-only flows:
--   1. Remove DELETE capability on the high-value transactional tables. No UI
--      deletes orders/returns, so this only blocks mass deletion via the public
--      key. Master-data deletes (online_items, online_platforms) and the internal
--      online_order_items upsert-delete are intentionally retained — the UI/flows
--      depend on them.
--   2. Add integrity CHECK constraints so direct writes via the public key cannot
--      corrupt core fields (status, payment mode, refund status, negative amounts).

-- 1. Remove DELETE policies on transactional + orphaned tables -----------------
DROP POLICY IF EXISTS "Allow anon delete" ON public.online_orders;

DROP POLICY IF EXISTS "Allow anon delete" ON public.online_returns;
DROP POLICY IF EXISTS "Authenticated users can delete online returns" ON public.online_returns;

DROP POLICY IF EXISTS "Allow all delete on online_dispatches" ON public.online_dispatches;
DROP POLICY IF EXISTS "Authenticated users can delete online dispatches" ON public.online_dispatches;

DROP POLICY IF EXISTS "Allow all delete on online_load_sheets" ON public.online_load_sheets;
DROP POLICY IF EXISTS "Authenticated users can delete online load sheets" ON public.online_load_sheets;

-- 2. Integrity guards ----------------------------------------------------------
ALTER TABLE public.online_orders
  ADD CONSTRAINT online_orders_status_chk
  CHECK (status IN (
    'pending','confirmed','sent_to_courier','dispatched',
    'delivered','return_awaited','returned','cancelled'
  ));

ALTER TABLE public.online_orders
  ADD CONSTRAINT online_orders_payment_mode_chk
  CHECK (payment_mode IN ('prepaid','cod'));

ALTER TABLE public.online_orders
  ADD CONSTRAINT online_orders_order_value_chk
  CHECK (order_value IS NULL OR order_value >= 0);

ALTER TABLE public.online_orders
  ADD CONSTRAINT online_orders_quantity_chk
  CHECK (quantity IS NULL OR quantity >= 0);

ALTER TABLE public.online_returns
  ADD CONSTRAINT online_returns_refund_status_chk
  CHECK (refund_status IN ('pending','refunded','rejected'));

ALTER TABLE public.online_returns
  ADD CONSTRAINT online_returns_refund_amount_chk
  CHECK (refund_amount IS NULL OR refund_amount >= 0);
