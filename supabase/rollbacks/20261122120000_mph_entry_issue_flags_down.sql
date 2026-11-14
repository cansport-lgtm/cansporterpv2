-- Rollback for 20261122120000_mph_entry_issue_flags.sql
-- Removes the entry issue flags from MPH Loss Reasons.
--
-- After this, run supabase/migrations/20261117120000_mph_loss_reason_required_threshold.sql
-- again to restore the previous mph_loss_report_save (the one here writes to
-- the columns dropped below).

DROP FUNCTION IF EXISTS public.mph_entry_issue_request(date, uuid);
DROP TABLE IF EXISTS public.mph_entry_requests;

ALTER TABLE public.mph_loss_report_departments
  DROP CONSTRAINT IF EXISTS mph_loss_report_departments_entry_issue_check;
ALTER TABLE public.mph_loss_report_departments
  DROP COLUMN IF EXISTS entry_issue,
  DROP COLUMN IF EXISTS no_production_confirmed,
  DROP COLUMN IF EXISTS no_production_confirmed_by,
  DROP COLUMN IF EXISTS no_production_confirmed_by_name,
  DROP COLUMN IF EXISTS no_production_confirmed_at;

-- "No production" reasons: delete the ones never used, deactivate the rest
-- (report lines keep a reference to the reason).
DELETE FROM public.mph_loss_reasons r
 WHERE r.category = 'No production'
   AND NOT EXISTS (SELECT 1 FROM public.mph_loss_report_lines l WHERE l.reason_id = r.id);
UPDATE public.mph_loss_reasons SET is_active = false WHERE category = 'No production';
