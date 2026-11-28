-- Rollback for 20261129130000_mph_loss_hr_approval.sql
-- Removes HR approval from MPH Loss Reasons.
--
-- After this, run supabase/migrations/20261122120000_mph_entry_issue_flags.sql
-- (restores mph_loss_report_save) and the mph_loss_report_reopen section of
-- supabase/migrations/20261102120100_mph_loss_reasons.sql again: the versions
-- here write to the columns dropped below.

DROP FUNCTION IF EXISTS public.mph_loss_report_hr_review(uuid, jsonb);
DROP INDEX IF EXISTS public.mph_loss_report_departments_hr_pending_idx;

ALTER TABLE public.mph_loss_report_departments
  DROP CONSTRAINT IF EXISTS mph_loss_report_departments_hr_status_check;
ALTER TABLE public.mph_loss_report_departments
  DROP COLUMN IF EXISTS hr_status,
  DROP COLUMN IF EXISTS hr_remarks,
  DROP COLUMN IF EXISTS hr_by,
  DROP COLUMN IF EXISTS hr_by_name,
  DROP COLUMN IF EXISTS hr_at;

ALTER TABLE public.mph_loss_reports DROP COLUMN IF EXISTS hr_flow;
