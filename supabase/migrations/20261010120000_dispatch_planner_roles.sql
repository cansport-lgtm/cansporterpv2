-- ============================================================================
-- Dispatch Planner roles
-- ----------------------------------------------------------------------------
-- Standard three-tier set for the new Dispatch Planner module (a read-only
-- planner that suggests dispatch days, loads and job orders from the pending
-- domestic sales orders, finished-goods stock and the fleet):
--
--   dispatch_planner_manager → everything the officer can, plus the vehicle
--                              master and deleting saved plan versions
--   dispatch_planner_officer → run suggestions, pin / flag lines, save plan
--                              versions, print and export
--   dispatch_planner_viewer  → read only
--
-- The tables and functions are added in 20261010120100_dispatch_planner.sql —
-- the new enum values can't be referenced in the same transaction that adds them.
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dispatch_planner_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dispatch_planner_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dispatch_planner_viewer';
