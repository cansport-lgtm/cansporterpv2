-- Rollback of 20261110120600_facilities_sims.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-sim-bill-reminder';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.facilities_sim_bill_reminder();
DROP FUNCTION IF EXISTS public.facilities_sim_bill_reopen(uuid);
DROP FUNCTION IF EXISTS public.facilities_sim_bill_note(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_sim_bill_post(uuid);
DROP FUNCTION IF EXISTS public.facilities_sim_bill_save_lines(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_sim_bill_start(text, date);
DROP FUNCTION IF EXISTS public.facilities_sim_move(jsonb);
DROP FUNCTION IF EXISTS public.facilities_sim_save(uuid, jsonb);
DROP VIEW IF EXISTS public.v_facilities_sim_over_limit;
DROP TABLE IF EXISTS public.facilities_sim_bill_lines;
DROP TABLE IF EXISTS public.facilities_sim_bills;
DROP TABLE IF EXISTS public.facilities_sim_movements;
DROP TABLE IF EXISTS public.facilities_sims;
DROP SEQUENCE IF EXISTS public.facilities_sim_movement_number_seq;
DELETE FROM public.facilities_events WHERE document_type IN ('sim','sim_bill');
