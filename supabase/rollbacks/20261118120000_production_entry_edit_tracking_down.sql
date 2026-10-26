-- Rollback for 20261118120000_production_entry_edit_tracking.sql
-- Removes production entry edit tracking: the trigger, the edit RPC, the
-- edit log, the super admin acknowledgement / daily reminder, and the
-- edit flags on production_entries. Edits already logged are lost.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'production-entry-edits-summary';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                AND tablename = 'production_entry_edits') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.production_entry_edits;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables
              WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                AND tablename = 'production_entries') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.production_entries;
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_production_entry_track_edit ON public.production_entries;
DROP FUNCTION IF EXISTS public.track_production_entry_edit();
DROP FUNCTION IF EXISTS public.production_entry_edit(uuid, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.production_entry_edits_acknowledge(uuid[]);
DROP FUNCTION IF EXISTS public.production_entry_edits_acknowledge_all();
DROP FUNCTION IF EXISTS public.production_entry_edits_daily_summary();
DROP FUNCTION IF EXISTS public.production_entry_edit_settings_save(boolean, time);
DROP FUNCTION IF EXISTS public.production_entry_field_display(text, jsonb);
DROP FUNCTION IF EXISTS public.production_entry_field_label(text);
DROP FUNCTION IF EXISTS public.production_entry_rejections_json(uuid);
DROP FUNCTION IF EXISTS public.production_entry_is_super_admin(uuid);

DROP TABLE IF EXISTS public.production_entry_edit_settings;
DROP TABLE IF EXISTS public.production_entry_edits;

DROP INDEX IF EXISTS public.idx_production_entries_edited;
ALTER TABLE public.production_entries
  DROP COLUMN IF EXISTS edit_count,
  DROP COLUMN IF EXISTS last_edited_at,
  DROP COLUMN IF EXISTS last_edited_by,
  DROP COLUMN IF EXISTS last_edit_reason,
  DROP COLUMN IF EXISTS edited_fields;
