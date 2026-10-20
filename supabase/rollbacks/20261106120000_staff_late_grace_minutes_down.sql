-- Rollback for 20261106120000_staff_late_grace_minutes.sql
-- Removes the per-employee late grace; the app falls back to 15 minutes.

ALTER TABLE public.employees DROP COLUMN IF EXISTS late_grace_minutes;
