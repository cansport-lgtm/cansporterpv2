-- Rollback of 20261110120100_facilities_core.sql. Run the sub-module
-- rollbacks (cameras, cleaning, assets, supplies, sims, equipment) first.
DROP FUNCTION IF EXISTS public.facilities_settings_save(jsonb);
DROP FUNCTION IF EXISTS public.facilities_today();
DROP FUNCTION IF EXISTS public.facilities_notify_user(uuid, text, text, text, text, uuid, text);
DROP FUNCTION IF EXISTS public.facilities_notify_managers(text, text, text, text, uuid, text, boolean);
DROP FUNCTION IF EXISTS public.facilities_log(text, uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.facilities_can(text);
DROP FUNCTION IF EXISTS public.facilities_has_any_role(text[]);
DROP TABLE IF EXISTS public.facilities_events;
DROP TABLE IF EXISTS public.facilities_settings;
