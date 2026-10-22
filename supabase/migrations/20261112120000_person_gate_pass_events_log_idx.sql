-- Worker / staff gate pass log: the approvers' page lists every pass event by
-- time (/labour/gate-pass/log, /hr/gate-pass/log) and the approvals page reads
-- the last 30 days of approve / reject decisions. Both filter and sort the
-- events tables by created_at, which only had an index per pass and a partial
-- one for rescan attempts. No data or rights change: the tables were already
-- readable by the app.
-- Rollback: supabase/rollbacks/20261112120000_person_gate_pass_events_log_idx_down.sql

CREATE INDEX IF NOT EXISTS labour_gate_pass_events_created_idx
  ON public.labour_gate_pass_events (created_at DESC);
CREATE INDEX IF NOT EXISTS staff_gate_pass_events_created_idx
  ON public.staff_gate_pass_events (created_at DESC);
