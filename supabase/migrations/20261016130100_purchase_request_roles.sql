-- ============================================================================
-- Purchase Request roles: an Officer and an Approver for each category
-- ----------------------------------------------------------------------------
--   pr_office_officer / pr_office_approver                 Office Supplies
--   pr_raw_material_officer / pr_raw_material_approver     Raw Material
--   pr_production_officer / pr_production_approver         Production Supplies
--   pr_spares_officer / pr_spares_approver                 Spares & Parts
--
--   *_officer   sees that category's requests on Purchase → Purchase Requests
--               (no other Purchase page); told when one is approved
--   *_approver  the officer's rights, plus the Purchase approval for that
--               category (lower quantities, set rates, approve / reject)
--
-- The rights are added in 20261016130200_purchase_request_role_rights.sql —
-- a new enum value can't be referenced in the transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_office_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_office_approver';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_raw_material_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_raw_material_approver';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_production_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_production_approver';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_spares_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'pr_spares_approver';
