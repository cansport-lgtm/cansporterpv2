-- pg_net enables server-side HTTP (used to invoke the postex Edge Function from
-- SQL / pg_cron for scheduled tracking sync).
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
