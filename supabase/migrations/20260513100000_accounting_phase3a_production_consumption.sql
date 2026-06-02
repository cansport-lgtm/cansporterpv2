-- ============================================================
-- Accounting Module — Phase 3a: Production Consumption Integration
-- Adds: standard_cost on raw materials, inventory default-account slots
-- ============================================================

-- 1) (Removed) Originally added standard_cost on raw materials, but consumption_raw_materials
-- already had a cost_value column (maintained via /consumption/raw-materials UI). The duplicate
-- was dropped in a follow-up migration; downstream code now reads cost_value directly.
-- No-op kept here as a marker.

-- 2) Seed inventory + cost default-account slots
-- These point at the Phase-1 seeded CoA codes.
INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'raw_material_inventory', id, 'Inventory account credited when raw materials are consumed in production'
  FROM public.accounting_chart_of_accounts WHERE code = '1130'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'raw_material_consumed', id, 'Expense account (COGS) debited when raw materials are consumed in production'
  FROM public.accounting_chart_of_accounts WHERE code = '5101'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'wip_inventory', id, 'Work-in-progress inventory account'
  FROM public.accounting_chart_of_accounts WHERE code = '1131'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'finished_goods_inventory', id, 'Finished goods inventory account'
  FROM public.accounting_chart_of_accounts WHERE code = '1132'
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.accounting_default_accounts (key, account_id, description)
SELECT 'cogs', id, 'Cost of Goods Sold — debited at sale of finished goods'
  FROM public.accounting_chart_of_accounts WHERE code = '5100'
ON CONFLICT (key) DO NOTHING;
