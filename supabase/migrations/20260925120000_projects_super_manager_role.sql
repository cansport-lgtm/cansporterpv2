-- ============================================================================
-- Projects Super Manager role
-- ----------------------------------------------------------------------------
-- Sees every user's projects and their progress in the Project Management
-- module and can create projects, tasks and documents, but can never delete
-- anything. Confined to the Project Management module + dashboard shell
-- (enforced in the app via route lockdown). Row-level rules are added in
-- 20260925120100_projects_super_manager_rls.sql — the new enum value can't be
-- referenced in the same transaction that adds it.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'projects_super_manager';
