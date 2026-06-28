-- Private key/value store for server-side integration secrets (e.g. the PostEx
-- API token). RLS is enabled with NO policies, so neither anon nor authenticated
-- roles can read any row via PostgREST — only the service role (used by Edge
-- Functions) bypasses RLS. Secret VALUES are never committed to git; they are
-- inserted out-of-band via a direct SQL statement.

CREATE TABLE IF NOT EXISTS public.integration_secrets (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: anon/authenticated get zero rows; service role bypasses RLS.
