-- ============================================================================
-- Admin & Facilities roles
-- ----------------------------------------------------------------------------
-- A new sidebar group "Admin & Facilities" (module key `facilities`) for the
-- office administration work: the daily security camera check, office
-- cleaning inspections, custody of office assets, the admin store and supply
-- requests, employee SIM cards and office equipment tickets.
--
--   facilities_manager     everything in the module but Settings: masters,
--                          review checks, close tickets, stock adjustments
--   facilities_officer     the admin officer: fills checks and inspections,
--                          issues / takes back assets, SIMs and supplies,
--                          works tickets, raises reorder purchase requests
--   facilities_viewer      read only
--   facilities_technician  sees and updates only the equipment tickets
--                          assigned to them
--   cleaning_supervisor    closes the cleaning action items assigned to them
--
-- Tables and functions come in 20261110120100_facilities_core.sql and the
-- sub-module migrations after it — a new enum value can't be referenced in
-- the transaction that adds it.
-- Rollback: supabase/rollbacks/20261110120000_facilities_roles_down.sql
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'facilities_manager';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'facilities_officer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'facilities_viewer';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'facilities_technician';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cleaning_supervisor';
