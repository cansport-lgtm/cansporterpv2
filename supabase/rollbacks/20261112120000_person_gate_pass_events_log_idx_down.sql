-- Rollback for 20261112120000_person_gate_pass_events_log_idx.sql.
-- Drops the created_at indexes on the gate pass events tables; the log pages still work, only slower.

DROP INDEX IF EXISTS public.labour_gate_pass_events_created_idx;
DROP INDEX IF EXISTS public.staff_gate_pass_events_created_idx;
