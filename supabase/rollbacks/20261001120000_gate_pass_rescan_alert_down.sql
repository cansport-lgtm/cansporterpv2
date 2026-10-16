-- Rollback for 20261001120000_gate_pass_rescan_alert.sql
-- Logged 'rescan_attempt' events stay in gate_pass_events.
DROP FUNCTION IF EXISTS public.gate_pass_log_rescan(uuid, text);
DROP INDEX IF EXISTS public.gate_pass_events_rescan_idx;
