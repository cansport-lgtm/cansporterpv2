-- ============================================================================
-- Rejections & Wastage: rw_leakages gets the three rework columns v1 has.
--
-- The v2 port (20260615130000_rejections_wastage_module.sql) left them out, so
-- rw_leakages was the one table of the seven that did not match v1. Found when
-- comparing live against the 10 Nov 2026 v1 backup. With these the seven
-- tables match v1 column for column, and v1 rows load without dropping fields.
--
-- Same definitions as v1: nullable, defaults 0 / 'pending', no check constraint.
-- v1 has never stored anything but the defaults in them.
-- ============================================================================

ALTER TABLE public.rw_leakages
  ADD COLUMN IF NOT EXISTS rework_qty numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS rework_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS rework_completed_at timestamptz;

NOTIFY pgrst, 'reload schema';
