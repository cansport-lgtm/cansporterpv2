-- Rollback for 20261201130000_biometric_bridge.sql.
-- WARNING: drops all stored punches, device users and device status.
DROP FUNCTION IF EXISTS public.device_attendance_daily(date, date, uuid);
DROP FUNCTION IF EXISTS public.device_users_auto_match();
DROP FUNCTION IF EXISTS public.device_user_set_employee(uuid, uuid);
DROP FUNCTION IF EXISTS public.device_attendance_can_manage();
DROP FUNCTION IF EXISTS public.bridge_heartbeat(text, text, boolean, integer, integer, text, text);
DROP FUNCTION IF EXISTS public.bridge_upsert_users(text, text, jsonb);
DROP FUNCTION IF EXISTS public.bridge_ingest_attendance(text, text, jsonb);
DROP FUNCTION IF EXISTS public.device_users_auto_match_internal(text);
DROP FUNCTION IF EXISTS public.bridge_require_key(text);
DROP TABLE IF EXISTS public.device_status;
DROP TABLE IF EXISTS public.device_users;
DROP TABLE IF EXISTS public.attendance_logs;
DROP TABLE IF EXISTS public.bridge_config;
