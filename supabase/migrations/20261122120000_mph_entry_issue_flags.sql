-- ============================================================================
-- MPH Loss Reasons: entry issue flags.
--
-- A department with labour deployed that earned 0 MPH is usually not a real
-- loss but an entry problem:
--   • production_missing  — no production entered, and the workers reported a
--                           quantity in Labour Productivity Entry
--   • check_deployment    — no production entered and no quantity reported
--                           (workers may be deployed to the wrong department)
--   • mph_number_missing  — production entered, but the sub-department has no
--                           MPH number, so the output earned nothing
-- Departments on a fixed daily MPH earn that allowance, so they are never
-- flagged.
--
-- While a flag is open the department takes no reasons and the report cannot
-- be submitted. The first two can be closed by confirming a real
-- no-production day, which then needs a reason from the "No production"
-- category with remarks. mph_number_missing can only be closed by setting the
-- MPH number.
--
-- The app applies the same rules (mphEntryIssue in src/lib/mphLoss.ts).
-- Replaces mph_loss_report_save from 20261117120000_mph_loss_reason_required_threshold.sql.
-- Rollback: supabase/rollbacks/20261122120000_mph_entry_issue_flags_down.sql
-- ============================================================================

-- 1. Flag and confirmation on the report's department rows --------------------

ALTER TABLE public.mph_loss_report_departments
  ADD COLUMN IF NOT EXISTS entry_issue text,
  ADD COLUMN IF NOT EXISTS no_production_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_production_confirmed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS no_production_confirmed_by_name text,
  ADD COLUMN IF NOT EXISTS no_production_confirmed_at timestamptz;

ALTER TABLE public.mph_loss_report_departments
  DROP CONSTRAINT IF EXISTS mph_loss_report_departments_entry_issue_check;
ALTER TABLE public.mph_loss_report_departments
  ADD CONSTRAINT mph_loss_report_departments_entry_issue_check
  CHECK (entry_issue IS NULL OR entry_issue IN ('production_missing', 'check_deployment', 'mph_number_missing'));

-- 2. "No production" reasons ---------------------------------------------------

INSERT INTO public.mph_loss_reasons (name, category, description, sort_order)
SELECT v.name, 'No production', v.description, v.sort_order
  FROM (VALUES
    ('Department / plant shutdown',        'Planned closure, no work scheduled',                    90),
    ('Machine breakdown - full day',       'Machine down the whole shift, workers on standby',      91),
    ('No order / no plan',                 'No job order or production plan for the day',           92),
    ('No material - full day',             'Material not available for the whole shift',            93),
    ('Power / utility failure - full day', 'No power, gas or air for the whole shift',              94),
    ('Workers on maintenance / cleaning',  'Deployed on maintenance, cleaning or shifting work',    95)
  ) AS v(name, description, sort_order)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.mph_loss_reasons r WHERE lower(btrim(r.name)) = lower(btrim(v.name))
 );

-- 3. Requests to the people who can fix the entry ------------------------------

CREATE TABLE IF NOT EXISTS public.mph_entry_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  entry_issue text NOT NULL,
  requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  requested_by_name text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (report_date, department_id)
);

ALTER TABLE public.mph_entry_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read mph_entry_requests" ON public.mph_entry_requests;
CREATE POLICY "Read mph_entry_requests" ON public.mph_entry_requests FOR SELECT TO public USING (true);
REVOKE ALL ON public.mph_entry_requests FROM anon, authenticated;
GRANT SELECT ON public.mph_entry_requests TO anon, authenticated, service_role;
GRANT ALL ON public.mph_entry_requests TO service_role;

-- One request per department and date. Works out the issue from the entries
-- themselves and notifies the roles that can fix it.
CREATE OR REPLACE FUNCTION public.mph_entry_issue_request(p_date date, p_department_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_name text;
  v_dept text;
  v_output numeric;
  v_authorized numeric;
  v_used numeric;
  v_actual numeric;
  v_workers integer;
  v_issue text;
  v_old public.mph_entry_requests%ROWTYPE;
  v_id uuid;
  v_day text := to_char(p_date, 'DD Mon YYYY');
  v_who text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in again to send the request.';
  END IF;
  IF NOT public.mph_loss_can_edit() THEN
    RAISE EXCEPTION 'Only the Production Coordinator or a super admin can send this request.';
  END IF;
  SELECT name INTO v_dept FROM public.production_departments WHERE id = p_department_id;
  IF p_date IS NULL OR v_dept IS NULL THEN
    RAISE EXCEPTION 'Pick the production date and department.';
  END IF;
  SELECT full_name INTO v_name FROM public.app_users WHERE id = v_uid;
  v_who := COALESCE(v_name, 'the Production Coordinator');

  SELECT COALESCE(sum(pe.quantity_produced), 0),
         COALESCE(sum(pe.quantity_produced * COALESCE((
           SELECT max(m.mph_number) FROM public.mph_calculating_numbers m
            WHERE m.is_active AND m.department_id = pe.department_id
              AND m.sub_department_id IS NOT DISTINCT FROM pe.sub_department_id), 0)), 0)
    INTO v_output, v_authorized
    FROM public.production_entries pe
   WHERE pe.entry_date = p_date AND pe.department_id = p_department_id;

  SELECT COALESCE(sum(t.mph), 0), COALESCE(sum(t.actual_quantity), 0), count(*)
    INTO v_used, v_actual, v_workers
    FROM public.labour_productivity_targets t
   WHERE t.target_date = p_date AND t.department_id = p_department_id;

  IF v_used <= 0 THEN
    RAISE EXCEPTION '% has no labour deployed on %.', v_dept, v_day;
  END IF;
  IF v_authorized > 0 THEN
    RAISE EXCEPTION '% now has production entered for %. Refresh the page.', v_dept, v_day;
  END IF;

  v_issue := CASE WHEN v_output > 0 THEN 'mph_number_missing'
                  WHEN v_actual > 0 THEN 'production_missing'
                  ELSE 'check_deployment' END;

  SELECT * INTO v_old FROM public.mph_entry_requests
   WHERE report_date = p_date AND department_id = p_department_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Already requested by % on %.',
      COALESCE(v_old.requested_by_name, 'a coordinator'), to_char(v_old.requested_at, 'DD Mon YYYY HH24:MI');
  END IF;

  INSERT INTO public.mph_entry_requests (report_date, department_id, entry_issue, requested_by, requested_by_name)
  VALUES (p_date, p_department_id, v_issue, v_uid, v_name)
  RETURNING id INTO v_id;

  IF v_issue = 'mph_number_missing' THEN
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[],
      'MPH number not set · ' || v_dept,
      v_dept || ' has ' || round(v_output, 1) || ' units entered for ' || v_day
        || ' but earned no MPH: a sub-department has no MPH number. Requested by ' || v_who || '.',
      'warning', 'production', '/production/mph-master',
      'mph_entry_request', v_id, v_uid, v_uid);
  ELSE
    PERFORM public.notify_role(
      ARRAY['production_manager', 'production_officer', 'production_operator', 'super_admin']::app_role[],
      'Production entry missing · ' || v_dept || ' · ' || v_day,
      v_workers || ' workers were deployed'
        || CASE WHEN v_actual > 0 THEN ' and reported ' || round(v_actual, 1) || ' units' ELSE '' END
        || ', but no production is entered. Requested by ' || v_who || '.',
      'warning', 'production', '/production/daily-entry',
      'mph_entry_request', v_id, v_uid, v_uid);
    IF v_issue = 'check_deployment' THEN
      PERFORM public.notify_role(
        ARRAY['labour_productivity_poster', 'labour_productivity_approver']::app_role[],
        'Check deployment · ' || v_dept || ' · ' || v_day,
        v_workers || ' workers are deployed to ' || v_dept
          || ' but the department has no production and the workers reported no quantity. '
          || 'Check they are deployed to the right department. Requested by ' || v_who || '.',
        'warning', 'labour', '/labour/todays-target',
        'mph_entry_request', v_id, v_uid, v_uid);
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'entry_issue', v_issue);
END;
$$;

REVOKE ALL ON FUNCTION public.mph_entry_issue_request(date, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.mph_entry_issue_request(date, uuid) TO anon, authenticated;

-- 4. Save / submit: honour the flags -------------------------------------------
--   p_departments: [{department_id, output, authorized_mph, used_mph, net_mph,
--                    entry_issue, no_production_confirmed}]

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

  -- Previous lines are kept as history, marked superseded.
  UPDATE public.mph_loss_report_lines SET superseded_at = now()
   WHERE report_id = r.id AND superseded_at IS NULL;

  SELECT COALESCE(array_agg((x->>'department_id')::uuid), ARRAY[]::uuid[]) INTO v_dept_ids
    FROM jsonb_array_elements(COALESCE(p_departments, '[]'::jsonb)) x;
  UPDATE public.mph_loss_report_departments SET superseded_at = now()
   WHERE report_id = r.id AND superseded_at IS NULL AND NOT (department_id = ANY (v_dept_ids));

  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_departments, '[]'::jsonb)) LOOP
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
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[],
      'MPH loss reasons submitted',
      r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' · '
        || round(r.total_loss, 1) || ' MPH lost, reasons given by ' || COALESCE(v_name, 'coordinator'),
      'info', 'labour', '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD'),
      'mph_loss_report', r.id, v_uid, v_uid);
  END IF;

  RETURN jsonb_build_object('id', r.id, 'report_number', r.report_number, 'status', r.status);
END;
$$;

GRANT EXECUTE ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) TO anon, authenticated;
