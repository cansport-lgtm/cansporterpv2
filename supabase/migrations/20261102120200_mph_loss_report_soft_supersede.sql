-- ============================================================================
-- MPH Loss Reasons: saving a report supersedes the previous lines instead of
-- deleting them. Earlier entries stay as history (superseded_at set); the
-- pages read only rows where superseded_at IS NULL. Replaces the
-- mph_loss_report_save from 20261102120100_mph_loss_reasons.sql.
-- ============================================================================

ALTER TABLE public.mph_loss_report_lines ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
ALTER TABLE public.mph_loss_report_departments ADD COLUMN IF NOT EXISTS superseded_at timestamptz;
CREATE INDEX IF NOT EXISTS mph_loss_report_lines_current_idx
  ON public.mph_loss_report_lines (report_id) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS mph_loss_report_departments_current_idx
  ON public.mph_loss_report_departments (report_id) WHERE superseded_at IS NULL;

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
  v_dept_ids uuid[];
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
    INSERT INTO public.mph_loss_report_departments
      (report_id, department_id, department_name, output, authorized_mph, used_mph, net_mph)
    SELECT r.id, pd.id, pd.name,
           COALESCE((d->>'output')::numeric, 0),
           COALESCE((d->>'authorized_mph')::numeric, 0),
           COALESCE((d->>'used_mph')::numeric, 0),
           COALESCE((d->>'net_mph')::numeric, 0)
      FROM public.production_departments pd
     WHERE pd.id = (d->>'department_id')::uuid
    ON CONFLICT (report_id, department_id) DO UPDATE SET
      department_name = EXCLUDED.department_name,
      output = EXCLUDED.output,
      authorized_mph = EXCLUDED.authorized_mph,
      used_mph = EXCLUDED.used_mph,
      net_mph = EXCLUDED.net_mph,
      superseded_at = NULL;
  END LOOP;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_order := v_order + 1;
    v_dept := (l->>'department_id')::uuid;
    v_mph := NULLIF(l->>'mph_lost', '')::numeric;

    IF NOT EXISTS (SELECT 1 FROM public.mph_loss_report_departments
                    WHERE report_id = r.id AND department_id = v_dept AND superseded_at IS NULL) THEN
      RAISE EXCEPTION 'A reason was given for a department that is not in this report.';
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

    INSERT INTO public.mph_loss_report_lines
      (report_id, department_id, reason_id, reason_name, reason_category, mph_lost,
       workers_affected, remarks, sort_order)
    VALUES (r.id, v_dept, v_reason.id, v_reason.name, v_reason.category, round(v_mph, 2),
            NULLIF(l->>'workers_affected', '')::integer, NULLIF(btrim(l->>'remarks'), ''), v_order);
  END LOOP;

  IF p_submit THEN
    -- Every department in loss must be fully explained (to within 0.05 MPH).
    SELECT dd.department_name, abs(dd.net_mph) AS loss, COALESCE(sum(ln.mph_lost), 0) AS explained
      INTO v_bad
      FROM public.mph_loss_report_departments dd
      LEFT JOIN public.mph_loss_report_lines ln
        ON ln.report_id = dd.report_id AND ln.department_id = dd.department_id AND ln.superseded_at IS NULL
     WHERE dd.report_id = r.id AND dd.net_mph < 0 AND dd.superseded_at IS NULL
     GROUP BY dd.department_name, dd.net_mph
    HAVING abs(abs(dd.net_mph) - COALESCE(sum(ln.mph_lost), 0)) > 0.05
     LIMIT 1;
    IF FOUND THEN
      RAISE EXCEPTION '%: % MPH lost but % MPH explained. Reasons must add up to the loss before submitting.',
        v_bad.department_name, round(v_bad.loss, 1), round(v_bad.explained, 1);
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

GRANT EXECUTE ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) TO authenticated;
