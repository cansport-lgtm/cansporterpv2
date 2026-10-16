-- Adds the standard three-tier role set for the Production module, so users can be
-- assigned graduated production access instead of the broad operational_manager role
-- or the narrow production_operator / order_management roles.
--
--   production_manager → view / create / edit / approve (no delete)
--   production_officer → view / create / edit
--   production_viewer  → view only
--
-- operational_manager, production_operator and order_management are untouched.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'production_viewer';
