-- Module-scoped access tiers for every module that had no dedicated role yet.
-- Each module gets three tiers (same pattern as the labour productivity roles):
--   <module>_manager → view / create / edit / approve (no delete; delete stays with super admin)
--   <module>_officer → view / create / edit (no delete / approve)
--   <module>_viewer  → view only
-- Modules covered: export, master_data, hr, wip_management, rejections_wastages,
-- performance, floor_inventory, fixed_assets, five_s, hourly_production, rd, crm, marketing.
-- (Maintenance / QA / Expenses / Material Consumption keep their existing roles.)

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'export_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'export_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'export_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'master_data_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'master_data_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'master_data_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hr_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'wip_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'wip_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'wip_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rejections_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rejections_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rejections_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'performance_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'performance_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'performance_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'floor_inventory_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'floor_inventory_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'floor_inventory_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fixed_assets_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fixed_assets_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'fixed_assets_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'five_s_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'five_s_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'five_s_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hourly_production_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hourly_production_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'hourly_production_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rd_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rd_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'rd_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'crm_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'crm_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'crm_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'marketing_viewer';
