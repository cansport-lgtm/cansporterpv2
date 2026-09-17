-- Adds the standard three-tier role set for the Private Label Sales module, so users
-- can be assigned graduated access instead of only the existing view-only distributor role.
--
--   private_label_manager → view / create / edit / approve (no delete)
--   private_label_officer → view / create / edit
--   private_label_viewer  → view only
--
-- private_label_distributor (view-only, used by external distributor accounts) is untouched.

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'private_label_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'private_label_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'private_label_viewer';
