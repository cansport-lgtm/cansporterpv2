-- Online Sales module — access tiers.
-- Three roles layer access over the existing self-contained Online Sales module:
--   • online_sales_admin   — full module owner: every page (incl. financials, P&L, masters,
--                            settlement) with all actions including delete and approve.
--   • online_sales_manager — full module visibility incl. financials; can create/edit/approve
--                            but cannot delete (separation of duties).
--   • online_sales_agent   — front-line fulfilment only (orders, customers, returns, live
--                            status, inventory). No financial/analytics/master pages, and never
--                            sees any monetary values (enforced in-app via canViewPrices).
-- ALTER TYPE ... ADD VALUE only adds the label (it does not reference it), so all three can be
-- added in a single migration; anything that USES these values lives in later migrations.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'online_sales_admin';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'online_sales_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'online_sales_agent';
