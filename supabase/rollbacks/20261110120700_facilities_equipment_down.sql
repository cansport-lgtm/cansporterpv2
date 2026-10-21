-- Rollback of 20261110120700_facilities_equipment.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-equipment-alerts';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.facilities_equipment_daily_alerts();
DROP FUNCTION IF EXISTS public.facilities_service_ticket_create(uuid);
DROP FUNCTION IF EXISTS public.facilities_ticket_from_camera(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.facilities_ticket_comment(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_ticket_reopen(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_ticket_close(uuid);
DROP FUNCTION IF EXISTS public.facilities_ticket_done(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_ticket_start(uuid);
DROP FUNCTION IF EXISTS public.facilities_ticket_assign(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.facilities_ticket_create(jsonb);
DROP FUNCTION IF EXISTS public.facilities_equipment_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_equipment_type_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_ticket_can_work(public.facilities_tickets);
DROP FUNCTION IF EXISTS public.facilities_ticket_label(public.facilities_tickets);
DROP VIEW IF EXISTS public.v_facilities_equipment_due;
DROP TABLE IF EXISTS public.facilities_ticket_comments;
DROP TABLE IF EXISTS public.facilities_tickets;
DROP TABLE IF EXISTS public.facilities_equipment;
DROP TABLE IF EXISTS public.facilities_equipment_types;
DROP SEQUENCE IF EXISTS public.facilities_ticket_number_seq;
DELETE FROM public.facilities_events WHERE document_type IN ('ticket','equipment');
