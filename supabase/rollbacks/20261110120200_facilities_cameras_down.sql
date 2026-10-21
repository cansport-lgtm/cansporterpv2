-- Rollback of 20261110120200_facilities_cameras.sql.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-camera-check-missed';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.facilities_camera_check_notify_missed();
DROP FUNCTION IF EXISTS public.facilities_camera_check_discard(uuid);
DROP FUNCTION IF EXISTS public.facilities_camera_check_review(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_camera_check_submit(uuid, text);
DROP FUNCTION IF EXISTS public.facilities_camera_check_save_recorder(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_camera_check_save_line(uuid, text, text, text);
DROP FUNCTION IF EXISTS public.facilities_camera_check_assert_draft(uuid);
DROP FUNCTION IF EXISTS public.facilities_camera_check_start(date);
DROP FUNCTION IF EXISTS public.facilities_camera_result_label(text);
DROP FUNCTION IF EXISTS public.facilities_camera_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.facilities_recorder_save(uuid, jsonb);
DROP TABLE IF EXISTS public.facilities_camera_check_alarms;
DROP TABLE IF EXISTS public.facilities_camera_check_recorders;
DROP TABLE IF EXISTS public.facilities_camera_check_lines;
DROP TABLE IF EXISTS public.facilities_camera_checks;
DROP TABLE IF EXISTS public.facilities_cameras;
DROP TABLE IF EXISTS public.facilities_recorders;
DROP SEQUENCE IF EXISTS public.facilities_camera_check_number_seq;
DELETE FROM public.facilities_events WHERE document_type = 'camera_check';
