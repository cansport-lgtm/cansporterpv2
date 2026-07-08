-- Audit trail for automated Google Drive backups (written by the
-- `db-backup-drive` Edge Function). RLS is enabled with no table policies, so
-- only the service role (the Edge Function) can insert/read rows directly.
-- The dashboard reads recent, non-sensitive status via the SECURITY DEFINER
-- helper `recent_backup_logs()` below.

CREATE TABLE IF NOT EXISTS public.backup_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  status       text NOT NULL,               -- 'success' | 'error'
  tables_count integer,
  total_bytes  bigint,
  pruned_count integer,
  duration_ms  integer,
  files        jsonb,                        -- [{ id, name, size }]
  error        text
);

CREATE INDEX IF NOT EXISTS backup_log_created_at_idx
  ON public.backup_log (created_at DESC);

ALTER TABLE public.backup_log ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: anon/authenticated get zero rows; service role bypasses RLS.

-- Non-sensitive status for the dashboard. Returns the most recent runs only;
-- excludes nothing sensitive (no secrets are stored on this table).
CREATE OR REPLACE FUNCTION public.recent_backup_logs(p_limit integer DEFAULT 10)
RETURNS TABLE (
  created_at   timestamptz,
  status       text,
  tables_count integer,
  total_bytes  bigint,
  pruned_count integer,
  duration_ms  integer,
  error        text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT created_at, status, tables_count, total_bytes, pruned_count, duration_ms, error
  FROM public.backup_log
  ORDER BY created_at DESC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 10), 100));
$$;

GRANT EXECUTE ON FUNCTION public.recent_backup_logs(integer) TO anon, authenticated, service_role;
