-- Distributor Order Management — Phase 3 (dispatch).
-- The order status check already allows 'dispatched' / 'delivered'; this migration
-- adds the audit columns the dispatch workflow writes when a manager marks an
-- approved order as dispatched and later delivered. Line-level fulfilment is
-- already tracked via distributor_order_items.quantity_dispatched (Phase 2).
ALTER TABLE public.distributor_orders
  ADD COLUMN IF NOT EXISTS dispatched_by uuid,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatch_notes text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'distributor_orders_dispatched_by_fkey'
      AND table_name = 'distributor_orders'
  ) THEN
    ALTER TABLE public.distributor_orders
      ADD CONSTRAINT distributor_orders_dispatched_by_fkey
      FOREIGN KEY (dispatched_by) REFERENCES public.app_users(id) ON DELETE SET NULL;
  END IF;
END $$;
