-- Rollback of 20261110120300_facilities_cleaning.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-cleaning-overdue';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.facilities_cleaning_notify_overdue();
DROP FUNCTION IF EXISTS public.facilities_cleaning_overdue_count(date);
DROP FUNCTION IF EXISTS public.facilities_cleaning_action_reassign(uuid, uuid, date);
DROP FUNCTION IF EXISTS public.facilities_cleaning_action_close(uuid, text, text);
DROP FUNCTION IF EXISTS public.facilities_inspection_cancel_draft(uuid);
DROP FUNCTION IF EXISTS public.facilities_inspection_submit(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_inspection_save_line(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.facilities_inspection_assert_editable(uuid);
DROP FUNCTION IF EXISTS public.facilities_inspection_start(uuid, date, text);
DROP FUNCTION IF EXISTS public.facilities_inspection_recalc(uuid);
DROP FUNCTION IF EXISTS public.facilities_area_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_cleaning_checkpoint_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_cleaning_template_save(uuid, jsonb);
DELETE FROM public.facilities_events WHERE document_type IN ('inspection','action_item');
DROP TABLE IF EXISTS public.facilities_cleaning_actions;
DROP TABLE IF EXISTS public.facilities_inspection_lines;
DROP TABLE IF EXISTS public.facilities_inspections;
DROP TABLE IF EXISTS public.facilities_areas;
DROP TABLE IF EXISTS public.facilities_cleaning_checkpoints;
DROP TABLE IF EXISTS public.facilities_cleaning_templates;
DROP SEQUENCE IF EXISTS public.facilities_inspection_number_seq;
