-- Rollback for 20261201130000_rw_report_language.sql
-- Removes the language column. The bilingual message texts are restored by
-- re-running the function definitions from 20261201120000_rw_daily_report.sql.
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_ui_language_check;
ALTER TABLE public.app_users DROP COLUMN IF EXISTS ui_language;
NOTIFY pgrst, 'reload schema';
