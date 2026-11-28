-- ============================================================================
-- MPH Loss Reasons: HR manager approval, per department.
--
-- Submitting a report no longer finalises it. Each department that has reasons
-- goes to HR as 'pending'; an HR manager (or super admin) approves or rejects
-- each one. A rejection needs remarks. Once every pending department is
-- decided: all approved -> the report stays submitted and locked; any
-- rejected -> the report returns to draft, where ONLY the rejected departments
-- can be edited (approved ones stay locked) and resubmitted.
--
-- Analysis and reports count a department's reasons only once approved.
--
-- Old reports are not touched: mph_loss_reports.hr_flow is false for every
-- existing row, and such reports keep counting as before. hr_flow is set on a
-- report the first time it is submitted under this flow.
--
-- Replaces mph_loss_report_save (20261122120000_mph_entry_issue_flags.sql) and
-- mph_loss_report_reopen (20261102120100_mph_loss_reasons.sql).
-- Rollback: supabase/rollbacks/20261129130000_mph_loss_hr_approval_down.sql
-- ============================================================================

ALTER TABLE public.mph_loss_reports
  ADD COLUMN IF NOT EXISTS hr_flow boolean NOT NULL DEFAULT false;

ALTER TABLE public.mph_loss_report_departments
  ADD COLUMN IF NOT EXISTS hr_status text,
  ADD COLUMN IF NOT EXISTS hr_remarks text,
  ADD COLUMN IF NOT EXISTS hr_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hr_by_name text,
  ADD COLUMN IF NOT EXISTS hr_at timestamptz;

ALTER TABLE public.mph_loss_report_departments
  DROP CONSTRAINT IF EXISTS mph_loss_report_departments_hr_status_check;
ALTER TABLE public.mph_loss_report_departments
  ADD CONSTRAINT mph_loss_report_departments_hr_status_check
  CHECK (hr_status IS NULL OR hr_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS mph_loss_report_departments_hr_pending_idx
  ON public.mph_loss_report_departments (report_id) WHERE hr_status = 'pending';

-- Save / submit ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mph_loss_report_save(
  p_date date, p_departments jsonb, p_lines jsonb, p_submit boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_name text;
  r public.mph_loss_reports%ROWTYPE;
  d jsonb;
  l jsonb;
  v_reason public.mph_loss_reasons%ROWTYPE;
  v_dept uuid;
  v_mph numeric;
  v_order integer := 0;
  v_bad record;
  v_drow record;
  v_dept_ids uuid[];
  v_output numeric;
  v_authorized numeric;
  v_used numeric;
  v_net numeric;
  v_issue text;
  v_confirmed boolean;
  -- Departments HR has already approved: locked, left exactly as approved.
  v_approved uuid[];
  -- Loss at or above this percent of the department's authorized MPH must be explained.
  v_required_pct constant numeric := 10;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to save MPH loss reasons.';
  END IF;
  IF NOT public.mph_loss_can_edit() THEN
    RAISE EXCEPTION 'Only the Production Coordinator or a super admin can enter MPH loss reasons.';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'Pick the production date.';
  END IF;
  SELECT full_name INTO v_name FROM public.app_users WHERE id = v_uid;

  INSERT INTO public.mph_loss_reports (report_date) VALUES (p_date)
  ON CONFLICT (report_date) DO NOTHING;
  SELECT * INTO r FROM public.mph_loss_reports WHERE report_date = p_date FOR UPDATE;

  IF r.status = 'submitted' THEN
    RAISE EXCEPTION 'The MPH loss report for % is already submitted. Ask a super admin to reopen it.',
      to_char(p_date, 'DD Mon YYYY');
  END IF;

  SELECT COALESCE(array_agg(department_id), ARRAY[]::uuid[]) INTO v_approved
    FROM public.mph_loss_report_departments
   WHERE report_id = r.id AND superseded_at IS NULL AND hr_status = 'approved';

  -- Previous lines are kept as history, marked superseded (except approved departments').
  UPDATE public.mph_loss_report_lines SET superseded_at = now()
   WHERE report_id = r.id AND superseded_at IS NULL AND NOT (department_id = ANY (v_approved));

  SELECT COALESCE(array_agg((x->>'department_id')::uuid), ARRAY[]::uuid[]) INTO v_dept_ids
    FROM jsonb_array_elements(COALESCE(p_departments, '[]'::jsonb)) x;
  UPDATE public.mph_loss_report_departments SET superseded_at = now()
   WHERE report_id = r.id AND superseded_at IS NULL AND NOT (department_id = ANY (v_dept_ids))
     AND NOT (department_id = ANY (v_approved));

  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_departments, '[]'::jsonb)) LOOP
    CONTINUE WHEN (d->>'department_id')::uuid = ANY (v_approved);
    v_output := COALESCE((d->>'output')::numeric, 0);
    v_authorized := COALESCE((d->>'authorized_mph')::numeric, 0);
    v_used := COALESCE((d->>'used_mph')::numeric, 0);
    v_net := COALESCE((d->>'net_mph')::numeric, 0);
    -- Labour used but nothing earned: an entry issue, worked out from the
    -- figures. The app only says which of the two no-production causes it is.
    v_issue := CASE
      WHEN v_authorized <= 0 AND v_used > 0 AND v_net < 0 THEN
        CASE WHEN v_output > 0 THEN 'mph_number_missing'
             WHEN d->>'entry_issue' = 'check_deployment' THEN 'check_deployment'
             ELSE 'production_missing' END
    END;
    v_confirmed := v_issue IS NOT NULL AND v_issue <> 'mph_number_missing'
                   AND COALESCE((d->>'no_production_confirmed')::boolean, false);

    INSERT INTO public.mph_loss_report_departments AS t
      (report_id, department_id, department_name, output, authorized_mph, used_mph, net_mph,
       entry_issue, no_production_confirmed,
       no_production_confirmed_by, no_production_confirmed_by_name, no_production_confirmed_at)
    SELECT r.id, pd.id, pd.name, v_output, v_authorized, v_used, v_net,
           v_issue, v_confirmed,
           CASE WHEN v_confirmed THEN v_uid END,
           CASE WHEN v_confirmed THEN v_name END,
           CASE WHEN v_confirmed THEN now() END
      FROM public.production_departments pd
     WHERE pd.id = (d->>'department_id')::uuid
    ON CONFLICT (report_id, department_id) DO UPDATE SET
      department_name = EXCLUDED.department_name,
      output = EXCLUDED.output,
      authorized_mph = EXCLUDED.authorized_mph,
      used_mph = EXCLUDED.used_mph,
      net_mph = EXCLUDED.net_mph,
      entry_issue = EXCLUDED.entry_issue,
      no_production_confirmed = EXCLUDED.no_production_confirmed,
      -- Keep who confirmed first while the confirmation stays in place.
      no_production_confirmed_by = CASE WHEN t.no_production_confirmed AND EXCLUDED.no_production_confirmed
        THEN t.no_production_confirmed_by ELSE EXCLUDED.no_production_confirmed_by END,
      no_production_confirmed_by_name = CASE WHEN t.no_production_confirmed AND EXCLUDED.no_production_confirmed
        THEN t.no_production_confirmed_by_name ELSE EXCLUDED.no_production_confirmed_by_name END,
      no_production_confirmed_at = CASE WHEN t.no_production_confirmed AND EXCLUDED.no_production_confirmed
        THEN t.no_production_confirmed_at ELSE EXCLUDED.no_production_confirmed_at END,
      superseded_at = NULL;
  END LOOP;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_order := v_order + 1;
    v_dept := (l->>'department_id')::uuid;
    CONTINUE WHEN v_dept = ANY (v_approved);
    v_mph := NULLIF(l->>'mph_lost', '')::numeric;

    SELECT department_name, entry_issue, no_production_confirmed INTO v_drow
      FROM public.mph_loss_report_departments
     WHERE report_id = r.id AND department_id = v_dept AND superseded_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A reason was given for a department that is not in this report.';
    END IF;
    IF v_drow.entry_issue IS NOT NULL AND NOT v_drow.no_production_confirmed THEN
      RAISE EXCEPTION '%: reasons cannot be given while its entry issue is open. Fix the entry, or confirm that the department had no production.',
        v_drow.department_name;
    END IF;

    SELECT * INTO v_reason FROM public.mph_loss_reasons WHERE id = NULLIF(l->>'reason_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select a reason on every line.';
    END IF;
    IF NOT v_reason.is_active THEN
      RAISE EXCEPTION 'Reason "%" is no longer active.', v_reason.name;
    END IF;
    IF NOT v_reason.applies_to_all AND NOT EXISTS (
         SELECT 1 FROM public.mph_loss_reason_departments
          WHERE reason_id = v_reason.id AND department_id = v_dept) THEN
      RAISE EXCEPTION 'Reason "%" does not apply to this department.', v_reason.name;
    END IF;
    IF v_mph IS NULL OR v_mph <= 0 THEN
      RAISE EXCEPTION 'Enter the MPH lost (more than 0) for reason "%".', v_reason.name;
    END IF;
    IF v_drow.no_production_confirmed THEN
      IF v_reason.category IS DISTINCT FROM 'No production' THEN
        RAISE EXCEPTION '%: a confirmed no-production day needs a reason from the "No production" category.',
          v_drow.department_name;
      END IF;
      IF NULLIF(btrim(l->>'remarks'), '') IS NULL THEN
        RAISE EXCEPTION '%: write in the remarks why there was no production.', v_drow.department_name;
      END IF;
    END IF;

    INSERT INTO public.mph_loss_report_lines
      (report_id, department_id, reason_id, reason_name, reason_category, mph_lost,
       workers_affected, remarks, sort_order)
    VALUES (r.id, v_dept, v_reason.id, v_reason.name, v_reason.category, round(v_mph, 2),
            NULLIF(l->>'workers_affected', '')::integer, NULLIF(btrim(l->>'remarks'), ''), v_order);
  END LOOP;

  IF p_submit THEN
    -- An open entry issue blocks the whole report.
    SELECT dd.department_name, dd.entry_issue INTO v_bad
      FROM public.mph_loss_report_departments dd
     WHERE dd.report_id = r.id AND dd.superseded_at IS NULL
       AND dd.entry_issue IS NOT NULL AND NOT dd.no_production_confirmed
     ORDER BY dd.department_name
     LIMIT 1;
    IF FOUND THEN
      IF v_bad.entry_issue = 'mph_number_missing' THEN
        RAISE EXCEPTION '%: production is entered but earned no MPH because the MPH number is not set. Set it in MPH Master before submitting.',
          v_bad.department_name;
      ELSE
        RAISE EXCEPTION '%: labour is deployed but no production is entered. Enter the production, or confirm that the department had no production, before submitting.',
          v_bad.department_name;
      END IF;
    END IF;

    -- A department whose loss is at least v_required_pct % of its authorized
    -- MPH must be fully explained (to within 0.05 MPH). A smaller loss is
    -- optional, but its reasons must not exceed the loss.
    SELECT dd.department_name,
           abs(dd.net_mph) AS loss,
           COALESCE(sum(ln.mph_lost), 0) AS explained,
           (dd.authorized_mph <= 0 OR abs(dd.net_mph) * 100 / dd.authorized_mph >= v_required_pct) AS required
      INTO v_bad
      FROM public.mph_loss_report_departments dd
      LEFT JOIN public.mph_loss_report_lines ln
        ON ln.report_id = dd.report_id AND ln.department_id = dd.department_id AND ln.superseded_at IS NULL
     WHERE dd.report_id = r.id AND dd.net_mph < 0 AND dd.superseded_at IS NULL
     GROUP BY dd.department_name, dd.net_mph, dd.authorized_mph
    HAVING CASE
             WHEN dd.authorized_mph <= 0 OR abs(dd.net_mph) * 100 / dd.authorized_mph >= v_required_pct
               THEN abs(abs(dd.net_mph) - COALESCE(sum(ln.mph_lost), 0)) > 0.05
             ELSE COALESCE(sum(ln.mph_lost), 0) - abs(dd.net_mph) > 0.05
           END
     ORDER BY (dd.authorized_mph <= 0 OR abs(dd.net_mph) * 100 / dd.authorized_mph >= v_required_pct) DESC
     LIMIT 1;
    IF FOUND THEN
      IF v_bad.required THEN
        RAISE EXCEPTION '%: % MPH lost but % MPH explained. A loss of % %% or more of the department''s MPH must be fully explained before submitting.',
          v_bad.department_name, round(v_bad.loss, 1), round(v_bad.explained, 1), v_required_pct;
      ELSE
        RAISE EXCEPTION '%: % MPH explained is more than the % MPH lost.',
          v_bad.department_name, round(v_bad.explained, 1), round(v_bad.loss, 1);
      END IF;
    END IF;
  END IF;

  UPDATE public.mph_loss_reports SET
    status = CASE WHEN p_submit THEN 'submitted' ELSE 'draft' END,
    hr_flow = r.hr_flow OR p_submit,
    total_authorized = COALESCE((SELECT sum(authorized_mph) FROM public.mph_loss_report_departments WHERE report_id = r.id AND superseded_at IS NULL), 0),
    total_used = COALESCE((SELECT sum(used_mph) FROM public.mph_loss_report_departments WHERE report_id = r.id AND superseded_at IS NULL), 0),
    total_loss = COALESCE((SELECT sum(-net_mph) FROM public.mph_loss_report_departments WHERE report_id = r.id AND net_mph < 0 AND superseded_at IS NULL), 0),
    submitted_by = CASE WHEN p_submit THEN v_uid ELSE NULL END,
    submitted_by_name = CASE WHEN p_submit THEN v_name ELSE NULL END,
    submitted_at = CASE WHEN p_submit THEN now() ELSE NULL END,
    production_changed_at = CASE WHEN p_submit THEN NULL ELSE production_changed_at END,
    updated_by = v_uid,
    updated_by_name = v_name
  WHERE id = r.id
  RETURNING * INTO r;

  IF p_submit THEN
    -- Every department that has reasons (and is not already approved) goes to HR.
    UPDATE public.mph_loss_report_departments dd SET
      hr_status = CASE WHEN EXISTS (
        SELECT 1 FROM public.mph_loss_report_lines ln
         WHERE ln.report_id = dd.report_id AND ln.department_id = dd.department_id AND ln.superseded_at IS NULL)
        THEN 'pending' END,
      hr_remarks = NULL, hr_by = NULL, hr_by_name = NULL, hr_at = NULL
     WHERE dd.report_id = r.id AND dd.superseded_at IS NULL AND dd.hr_status IS DISTINCT FROM 'approved';

    PERFORM public.notify_role(ARRAY['hr_manager', 'super_admin']::app_role[],
      'MPH loss reasons waiting for HR approval',
      r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' · '
        || (SELECT count(*) FROM public.mph_loss_report_departments WHERE report_id = r.id AND superseded_at IS NULL AND hr_status = 'pending')
        || ' department(s) to review, reasons given by ' || COALESCE(v_name, 'coordinator'),
      'warning', 'labour', '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD'),
      'mph_loss_report', r.id, v_uid, v_uid);
  END IF;

  RETURN jsonb_build_object('id', r.id, 'report_number', r.report_number, 'status', r.status);
END;
$$;


REVOKE ALL ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) TO authenticated;


-- HR decision -----------------------------------------------------------------
--   p_decisions: [{department_id, decision: 'approved' | 'rejected', remarks}]

CREATE OR REPLACE FUNCTION public.mph_loss_report_hr_review(p_report_id uuid, p_decisions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_name text;
  r public.mph_loss_reports%ROWTYPE;
  x jsonb;
  v_dept uuid;
  v_decision text;
  v_remarks text;
  v_dname text;
  v_pending integer;
  v_rejected integer;
  v_rejected_names text;
  v_link text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to review MPH loss reasons.';
  END IF;
  IF NOT public.gate_pass_has_any_role(ARRAY['hr_manager', 'super_admin']) THEN
    RAISE EXCEPTION 'Only an HR manager or a super admin can approve MPH loss reasons.';
  END IF;
  SELECT full_name INTO v_name FROM public.app_users WHERE id = v_uid;

  SELECT * INTO r FROM public.mph_loss_reports WHERE id = p_report_id FOR UPDATE;
  IF NOT FOUND OR r.status <> 'submitted' OR NOT r.hr_flow THEN
    RAISE EXCEPTION 'This report is not waiting for HR approval.';
  END IF;
  IF jsonb_array_length(COALESCE(p_decisions, '[]'::jsonb)) = 0 THEN
    RAISE EXCEPTION 'Choose approve or reject for at least one department.';
  END IF;

  FOR x IN SELECT * FROM jsonb_array_elements(p_decisions) LOOP
    v_dept := (x->>'department_id')::uuid;
    v_decision := x->>'decision';
    v_remarks := NULLIF(btrim(x->>'remarks'), '');
    IF v_decision NOT IN ('approved', 'rejected') THEN
      RAISE EXCEPTION 'Decision must be approved or rejected.';
    END IF;
    SELECT department_name INTO v_dname FROM public.mph_loss_report_departments
     WHERE report_id = r.id AND department_id = v_dept AND superseded_at IS NULL AND hr_status = 'pending';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A department in this review is not pending HR approval. Refresh the page.';
    END IF;
    IF v_decision = 'rejected' AND v_remarks IS NULL THEN
      RAISE EXCEPTION '%: write the remarks for the rejection.', v_dname;
    END IF;
    UPDATE public.mph_loss_report_departments SET
      hr_status = v_decision, hr_remarks = v_remarks,
      hr_by = v_uid, hr_by_name = v_name, hr_at = now()
     WHERE report_id = r.id AND department_id = v_dept AND superseded_at IS NULL;
  END LOOP;

  SELECT count(*) FILTER (WHERE hr_status = 'pending'),
         count(*) FILTER (WHERE hr_status = 'rejected'),
         string_agg(department_name, ', ' ORDER BY department_name) FILTER (WHERE hr_status = 'rejected')
    INTO v_pending, v_rejected, v_rejected_names
    FROM public.mph_loss_report_departments
   WHERE report_id = r.id AND superseded_at IS NULL;

  v_link := '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD');

  IF v_pending = 0 THEN
    IF v_rejected > 0 THEN
      -- Back to the coordinator; approved departments stay locked.
      UPDATE public.mph_loss_reports SET status = 'draft', updated_by = v_uid, updated_by_name = v_name
       WHERE id = r.id RETURNING * INTO r;
      PERFORM public.notify_role(ARRAY['production_coordinator']::app_role[],
        'MPH loss reasons rejected by HR',
        r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' · rejected: ' || v_rejected_names
          || ' — correct them and submit again',
        'warning', 'labour', v_link, 'mph_loss_report', r.id, v_uid, v_uid);
    ELSE
      UPDATE public.mph_loss_reports SET updated_by = v_uid, updated_by_name = v_name
       WHERE id = r.id RETURNING * INTO r;
      PERFORM public.notify_role(ARRAY['production_coordinator']::app_role[],
        'MPH loss reasons approved by HR',
        r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' — all departments approved',
        'info', 'labour', v_link, 'mph_loss_report', r.id, v_uid, v_uid);
    END IF;
  END IF;

  RETURN jsonb_build_object('id', r.id, 'status', r.status, 'pending', v_pending, 'rejected', v_rejected);
END;
$$;

REVOKE ALL ON FUNCTION public.mph_loss_report_hr_review(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_hr_review(uuid, jsonb) TO authenticated;

-- Reopen: also clears HR decisions, so the report is approved afresh -------------

CREATE OR REPLACE FUNCTION public.mph_loss_report_reopen(p_report_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.mph_loss_reports%ROWTYPE;
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can reopen a submitted MPH loss report.';
  END IF;
  UPDATE public.mph_loss_reports SET
    status = 'draft',
    reopened_by = v_uid,
    reopened_by_name = (SELECT full_name FROM public.app_users WHERE id = v_uid),
    reopened_at = now()
  WHERE id = p_report_id AND status = 'submitted'
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found or not submitted.';
  END IF;

  IF r.hr_flow THEN
    UPDATE public.mph_loss_report_departments
       SET hr_status = NULL, hr_remarks = NULL, hr_by = NULL, hr_by_name = NULL, hr_at = NULL
     WHERE report_id = r.id AND superseded_at IS NULL;
  END IF;

  PERFORM public.notify_role(ARRAY['production_coordinator']::app_role[],
    'MPH loss report reopened',
    r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' was reopened — check the reasons and submit again',
    'warning', 'labour', '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD'),
    'mph_loss_report', r.id, v_uid, v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.mph_loss_report_reopen(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_reopen(uuid) TO authenticated;
