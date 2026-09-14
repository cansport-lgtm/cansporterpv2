-- ============================================================================
-- QA Inspector role
-- ----------------------------------------------------------------------------
-- A single-purpose Quality Assurance role that ONLY records inspections. It is
-- confined to the inspection entry form (/qa/operator-inspection) and can only
-- create inspections — no QA dashboard, lists, release, or any other page
-- (enforced in the app via route lockdown + create-only permission grant).
-- ============================================================================

ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'qa_inspector';
