-- ============================================================================
-- Master Data Administrator role
-- ----------------------------------------------------------------------------
--   master_data_admin → full control of the Master Data module: view, create,
--                       edit, approve AND delete on every master (departments,
--                       sub-departments, grades, products/SKUs, items, units,
--                       defect / downtime reasons, hourly loss reasons).
--
-- Unlike the three existing tiers (master_data_manager / _officer / _viewer,
-- where delete stays with super admin), this role may delete. That is safe
-- because every master table is now under the central audit trail
-- (20261005120100_master_data_change_tracking.sql) and super admin reviews
-- all of it on Master Data → Change Log. The role is confined to /master
-- (+ the dashboard shell) in the app, like the other module tiers.
--
-- The audit triggers are added in the next migration — a new enum value
-- can't be referenced in the transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'master_data_admin';
