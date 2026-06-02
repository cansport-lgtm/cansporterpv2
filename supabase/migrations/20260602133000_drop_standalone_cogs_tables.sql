-- The invoice-wise COGS page now reads from products.standard_cost (the single cost master
-- that also drives the accounting module's GL/P&L COGS postings). The standalone standard_costs
-- and dispatch_item_cogs tables and their RPCs are no longer used — drop them to avoid a second,
-- divergent cost master.

DROP FUNCTION IF EXISTS public.recompute_dispatch_cogs(UUID, UUID);
DROP FUNCTION IF EXISTS public.upsert_standard_cost(UUID, UUID, NUMERIC, UUID);
DROP TABLE IF EXISTS public.dispatch_item_cogs;
DROP TABLE IF EXISTS public.standard_costs;
