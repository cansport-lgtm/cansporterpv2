-- ============================================================================
-- Biometric attendance bridge (ZKTeco device -> LAN bridge -> ERP)
-- ----------------------------------------------------------------------------
-- A small program on the office LAN reads the attendance device and PUSHES
-- punches / users / heartbeats to the ERP over HTTPS (/api/bridge/*, see
-- api/bridge and docs/BIOMETRIC_BRIDGE.md). This migration holds the data.
--
--   * attendance_logs  raw punches, idempotent on external_id (never deleted)
--   * device_users     device user id -> optional link to an ERP employee
--   * device_status    last heartbeat per device (one row)
--   * bridge_config    sha256 of the bridge API key (single row). NO client
--                      access: the hash is set out-of-band, never in git.
--
-- The existing public.attendance table (one row per employee per day, HR
-- entered) is NOT touched; punches are a separate raw feed.
--
-- Security model: the Vercel routes call the bridge_* functions with the
-- publishable key, so every bridge_* function re-checks the bridge API key
-- itself (SECURITY DEFINER, constant-shape sha256 compare). Without the key
-- they raise 'unauthorized'. Tables are read-only to clients (same convention
-- as the rest of the ERP); the only client write is device_user_set_employee,
-- which checks the caller's HR role.
-- Rollback: supabase/rollbacks/20261201130000_biometric_bridge_down.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.bridge_config (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  key_hash text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.bridge_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.bridge_config ENABLE ROW LEVEL SECURITY;      -- no policies, no grants
REVOKE ALL ON public.bridge_config FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.attendance_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id text NOT NULL UNIQUE,
  device_serial text NOT NULL,
  user_id text NOT NULL,                       -- the device's user id (string)
  punched_at timestamptz NOT NULL,             -- device zone is Asia/Karachi
  verify_mode text NOT NULL DEFAULT 'unknown', -- fingerprint|face|card|password|palm|other|unknown-<n>
  state text NOT NULL DEFAULT 'unknown',       -- check-in|check-out|break-*|overtime-*|unknown-<n>
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attendance_logs_user_time_idx ON public.attendance_logs (user_id, punched_at);
CREATE INDEX IF NOT EXISTS attendance_logs_time_idx ON public.attendance_logs (punched_at);

CREATE TABLE IF NOT EXISTS public.device_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_serial text NOT NULL,
  user_id text NOT NULL,
  name text NOT NULL DEFAULT '',
  card_no text NOT NULL DEFAULT '0',
  privilege integer NOT NULL DEFAULT 0,
  employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  mapped_manually boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_serial, user_id)
);
CREATE INDEX IF NOT EXISTS device_users_employee_idx ON public.device_users (employee_id);
CREATE INDEX IF NOT EXISTS device_users_user_idx ON public.device_users (user_id);

CREATE TABLE IF NOT EXISTS public.device_status (
  device_serial text PRIMARY KEY,
  device_online boolean NOT NULL DEFAULT false,
  user_count integer,
  log_count integer,
  last_sync_at timestamptz,
  bridge_version text,
  received_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['attendance_logs','device_users','device_status'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Key check ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bridge_require_key(p_key text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE v_hash text;
BEGIN
  SELECT key_hash INTO v_hash FROM public.bridge_config WHERE id = 1;
  IF v_hash IS NULL OR p_key IS NULL OR p_key = ''
     OR encode(digest(p_key, 'sha256'), 'hex') <> v_hash THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;
END;
$$;

-- 3. Employee matching -------------------------------------------------------
-- Device user id is usually the employee code. Try exact, then trimmed, then
-- zero-padding-insensitive ("007" = "7"). Only an unambiguous match is linked,
-- and never over a link a person made by hand.

CREATE OR REPLACE FUNCTION public.device_users_auto_match_internal(p_serial text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer;
BEGIN
  WITH emp AS (
    SELECT id, employee_code,
           btrim(employee_code) AS trimmed,
           COALESCE(NULLIF(ltrim(btrim(employee_code), '0'), ''), '0') AS norm
      FROM public.employees
  ),
  cand AS (
    SELECT du.id AS du_id, e.id AS emp_id,
           CASE WHEN e.employee_code = du.user_id THEN 1
                WHEN e.trimmed = btrim(du.user_id) THEN 2
                ELSE 3 END AS rank
      FROM public.device_users du
      JOIN emp e
        ON e.trimmed = btrim(du.user_id)
        OR e.norm = COALESCE(NULLIF(ltrim(btrim(du.user_id), '0'), ''), '0')
     WHERE du.employee_id IS NULL
       AND du.mapped_manually = false
       AND (p_serial IS NULL OR du.device_serial = p_serial)
  ),
  best AS (
    SELECT du_id, min(rank) AS rank FROM cand GROUP BY du_id
  ),
  pick AS (
    SELECT c.du_id, min(c.emp_id::text)::uuid AS emp_id, count(*) AS n
      FROM cand c JOIN best b ON b.du_id = c.du_id AND b.rank = c.rank
     GROUP BY c.du_id
  ),
  -- an employee claimed by several device users in this pass is ambiguous too
  uniq AS (
    SELECT du_id, emp_id FROM pick
     WHERE n = 1 AND emp_id IN (SELECT emp_id FROM pick WHERE n = 1 GROUP BY emp_id HAVING count(*) = 1)
       AND NOT EXISTS (SELECT 1 FROM public.device_users x WHERE x.employee_id = pick.emp_id)
  )
  UPDATE public.device_users du
     SET employee_id = u.emp_id, updated_at = now()
    FROM uniq u
   WHERE du.id = u.du_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- 4. Bridge ingest functions (called by api/bridge/*) ------------------------

CREATE OR REPLACE FUNCTION public.bridge_ingest_attendance(
  p_key text, p_device_serial text, p_records jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_received integer := jsonb_array_length(p_records);
  v_inserted integer;
BEGIN
  PERFORM public.bridge_require_key(p_key);
  IF v_received > 500 THEN
    RAISE EXCEPTION 'too many records (max 500)' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.attendance_logs (external_id, device_serial, user_id, punched_at, verify_mode, state)
  SELECT r.external_id, p_device_serial, r.user_id, r.ts::timestamptz,
         COALESCE(NULLIF(r.verify_mode, ''), 'unknown'), COALESCE(NULLIF(r.state, ''), 'unknown')
    FROM jsonb_to_recordset(p_records) AS r(
           external_id text, user_id text, ts text, verify_mode text, state text)
  ON CONFLICT (external_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('received', v_received, 'inserted', v_inserted,
                            'duplicates', v_received - v_inserted);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_upsert_users(
  p_key text, p_device_serial text, p_users jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_received integer := jsonb_array_length(p_users);
BEGIN
  PERFORM public.bridge_require_key(p_key);

  -- employee_id / mapped_manually are never touched by a device sync.
  INSERT INTO public.device_users (device_serial, user_id, name, card_no, privilege)
  SELECT p_device_serial, u.user_id, COALESCE(u.name, ''), COALESCE(NULLIF(u.card_no, ''), '0'),
         COALESCE(u.privilege, 0)
    FROM (SELECT DISTINCT ON (user_id) * FROM jsonb_to_recordset(p_users)
            AS x(user_id text, name text, card_no text, privilege integer)
           ORDER BY user_id) u
  ON CONFLICT (device_serial, user_id) DO UPDATE
     SET name = EXCLUDED.name, card_no = EXCLUDED.card_no,
         privilege = EXCLUDED.privilege, updated_at = now();

  PERFORM public.device_users_auto_match_internal(p_device_serial);
  RETURN jsonb_build_object('received', v_received);
END;
$$;

CREATE OR REPLACE FUNCTION public.bridge_heartbeat(
  p_key text, p_device_serial text, p_device_online boolean, p_user_count integer,
  p_log_count integer, p_last_sync_at text, p_bridge_version text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.bridge_require_key(p_key);
  INSERT INTO public.device_status
    (device_serial, device_online, user_count, log_count, last_sync_at, bridge_version, received_at)
  VALUES (p_device_serial, COALESCE(p_device_online, false), p_user_count, p_log_count,
          NULLIF(p_last_sync_at, '')::timestamptz, p_bridge_version, now())
  ON CONFLICT (device_serial) DO UPDATE
     SET device_online = EXCLUDED.device_online, user_count = EXCLUDED.user_count,
         log_count = EXCLUDED.log_count, last_sync_at = EXCLUDED.last_sync_at,
         bridge_version = EXCLUDED.bridge_version, received_at = now();
END;
$$;

-- 5. Client-facing functions -------------------------------------------------

CREATE OR REPLACE FUNCTION public.device_attendance_can_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = public.app_user_id()
       AND role::text IN ('super_admin','hr_manager','hr_officer'));
$$;

-- Link (or unlink with NULL) a device user to an employee by hand.
CREATE OR REPLACE FUNCTION public.device_user_set_employee(p_device_user_id uuid, p_employee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.device_attendance_can_manage() THEN
    RAISE EXCEPTION 'Not allowed to map device users';
  END IF;
  IF p_employee_id IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.device_users WHERE employee_id = p_employee_id AND id <> p_device_user_id) THEN
    RAISE EXCEPTION 'That employee is already linked to another device user';
  END IF;
  UPDATE public.device_users
     SET employee_id = p_employee_id, mapped_manually = (p_employee_id IS NOT NULL), updated_at = now()
   WHERE id = p_device_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.device_users_auto_match()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.device_attendance_can_manage() THEN
    RAISE EXCEPTION 'Not allowed to map device users';
  END IF;
  RETURN public.device_users_auto_match_internal(NULL);
END;
$$;

-- Daily summary per device user, days grouped in Asia/Karachi.
-- First punch = in, last punch = out (the device's in/out button is unreliable).
CREATE OR REPLACE FUNCTION public.device_attendance_daily(p_from date, p_to date, p_employee_id uuid DEFAULT NULL)
RETURNS TABLE (
  day date, user_id text, device_name text, employee_id uuid, employee_code text, employee_name text,
  first_in timestamptz, last_out timestamptz, punches integer, hours_worked numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH p AS (
    SELECT l.user_id, (l.punched_at AT TIME ZONE 'Asia/Karachi')::date AS day,
           min(l.punched_at) AS first_in, max(l.punched_at) AS last_out, count(*)::integer AS punches
      FROM public.attendance_logs l
     WHERE l.punched_at >= (p_from::timestamp AT TIME ZONE 'Asia/Karachi')
       AND l.punched_at <  ((p_to + 1)::timestamp AT TIME ZONE 'Asia/Karachi')
     GROUP BY 1, 2
  ),
  du AS (
    SELECT DISTINCT ON (user_id) user_id, name, employee_id
      FROM public.device_users ORDER BY user_id, (employee_id IS NULL), updated_at DESC
  )
  SELECT p.day, p.user_id, du.name, du.employee_id, e.employee_code, e.full_name,
         p.first_in, p.last_out, p.punches,
         CASE WHEN p.punches > 1
              THEN round(extract(epoch FROM (p.last_out - p.first_in)) / 3600.0, 2) END
    FROM p
    LEFT JOIN du ON du.user_id = p.user_id
    LEFT JOIN public.employees e ON e.id = du.employee_id
   WHERE p_employee_id IS NULL OR du.employee_id = p_employee_id
   ORDER BY p.day DESC, e.full_name NULLS LAST, p.user_id;
$$;

-- 6. Grants ------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.bridge_require_key(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.device_users_auto_match_internal(text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.bridge_ingest_attendance(text, text, jsonb),
  public.bridge_upsert_users(text, text, jsonb),
  public.bridge_heartbeat(text, text, boolean, integer, integer, text, text),
  public.device_attendance_can_manage(),
  public.device_user_set_employee(uuid, uuid),
  public.device_users_auto_match(),
  public.device_attendance_daily(date, date, uuid)
  TO anon, authenticated, service_role;
