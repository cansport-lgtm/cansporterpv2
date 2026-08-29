-- Completes the three-tier role set for the last five modules.
--
-- Projects, QA and Maintenance already had a manager-equivalent role
-- (project_manager / qa_manager / maintenance_manager); those keep their names and
-- gain the manager tier's permissions in the app, so only the officer and viewer
-- tiers are added here. Expenses and Material Consumption had no manager-equivalent
-- role (pettycash_handler and store_operator are narrow single-purpose roles that
-- stay as they are), so all three tiers are added for them.
--
--   <module>_manager → view / create / edit / approve (no delete)
--   <module>_officer → view / create / edit
--   <module>_viewer  → view only

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'projects_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'projects_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qa_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qa_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'maintenance_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'maintenance_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'expenses_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'expenses_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'expenses_viewer';

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'material_consumption_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'material_consumption_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'material_consumption_viewer';
