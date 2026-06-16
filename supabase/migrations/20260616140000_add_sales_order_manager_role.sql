-- Sales Order Management role.
-- Manages domestic sales orders and coordinates dispatch, but cannot create
-- customers or products, cannot see prices/amounts, and has no invoice access.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sales_order_manager';
