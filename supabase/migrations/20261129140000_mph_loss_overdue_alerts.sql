-- ============================================================================
-- MPH Loss Reasons: alert super admins when a report is overdue (24 hours).
--
-- Two stages, each alerted ONCE per report (re-armed when the report changes stage):
--   1. Not submitted: the report is still a draft 24 hours after production was
--      posted (notified_at), or 24 hours after it was reopened / returned by HR.
--   2. Not approved: submitted to HR, with departments still pending, 24 hours
--      after submitted_at.
--
-- A pg_cron job checks every 30 minutes and notifies super_admin. Reports from
-- before HR approval (hr_flow = false) are never alerted at stage 2, and drafts
-- whose clock started before v_since are skipped so old drafts do not flood.
--
-- Rollback: supabase/rollbacks/20261129140000_mph_loss_overdue_alerts_down.sql
-- ============================================================================

ALTER TABLE public.mph_loss_reports
  ADD COLUMN IF NOT EXISTS hr_returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS unsubmitted_alerted_at timestamptz,
  ADD COLUMN IF NOT EXISTS unapproved_alerted_at timestamptz;

-- A change of stage restarts the 24-hour clock and re-arms both alerts.
CREATE OR REPLACE FUNCTION public.mph_loss_reports_stage_reset()
RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.unsubmitted_alerted_at := NULL;
    NEW.unapproved_alerted_at := NULL;
    IF OLD.status = 'submitted' AND NEW.status = 'draft' THEN
      NEW.hr_returned_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mph_loss_reports_stage_reset ON public.mph_loss_reports;
CREATE TRIGGER trg_mph_loss_reports_stage_reset
  BEFORE UPDATE OF status ON public.mph_loss_reports
  FOR EACH ROW EXECUTE FUNCTION public.mph_loss_reports_stage_reset();

CREATE OR REPLACE FUNCTION public.mph_loss_notify_overdue(p_hours integer DEFAULT 24)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r record;
  v_count integer := 0;
  v_pending integer;
  v_names text;
  -- Drafts whose clock started before this are ignored (reports from before the alert).
  v_since constant timestamptz := '2026-11-28 00:00:00+00';
  v_link text;
BEGIN
  -- 1. Reasons not submitted
  FOR r IN
    SELECT id, report_number, report_date,
           GREATEST(COALESCE(notified_at, created_at),
                    COALESCE(reopened_at, '-infinity'::timestamptz),
                    COALESCE(hr_returned_at, '-infinity'::timestamptz)) AS since
      FROM public.mph_loss_reports
     WHERE status = 'draft' AND unsubmitted_alerted_at IS NULL
  LOOP
    CONTINUE WHEN r.since < v_since OR r.since > now() - make_interval(hours => p_hours);
    v_link := '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD');
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[],
      'MPH loss reasons not submitted',
      r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' — still not submitted '
        || floor(extract(epoch FROM now() - r.since) / 3600) || ' hours after it was due',
      'warning', 'labour', v_link, 'mph_loss_report', r.id, NULL, NULL);
    UPDATE public.mph_loss_reports SET unsubmitted_alerted_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  -- 2. Submitted, but HR has not approved
  FOR r IN
    SELECT id, report_number, report_date, submitted_at
      FROM public.mph_loss_reports
     WHERE status = 'submitted' AND hr_flow AND unapproved_alerted_at IS NULL
       AND submitted_at <= now() - make_interval(hours => p_hours)
  LOOP
    SELECT count(*), string_agg(department_name, ', ' ORDER BY department_name)
      INTO v_pending, v_names
      FROM public.mph_loss_report_departments
     WHERE report_id = r.id AND superseded_at IS NULL AND hr_status = 'pending';
    CONTINUE WHEN v_pending = 0;
    v_link := '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD');
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[],
      'MPH loss reasons not approved by HR',
      r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' — ' || v_pending
        || ' department(s) waiting for HR approval for '
        || floor(extract(epoch FROM now() - r.submitted_at) / 3600) || ' hours: ' || v_names,
      'warning', 'labour', v_link, 'mph_loss_report', r.id, NULL, NULL);
    UPDATE public.mph_loss_reports SET unapproved_alerted_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mph_loss_notify_overdue(integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mph_loss_notify_overdue(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mph-loss-overdue-alerts';
    PERFORM cron.schedule('mph-loss-overdue-alerts', '*/30 * * * *', 'SELECT public.mph_loss_notify_overdue(24)');
  END IF;
END $$;
