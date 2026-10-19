-- ============================================================================
-- MPH Loss Reasons
-- ----------------------------------------------------------------------------
-- MPH Analysis shows, per department and day, Authorized MPH (earned from
-- production output) against Used MPH (labour deployed). A negative net is a
-- loss. This records WHY each loss happened:
--
--   • mph_loss_reasons            — the reason master (super admin only).
--   • mph_loss_reason_departments — which departments a reason applies to
--                                   (ignored when applies_to_all is true).
--   • mph_loss_reports            — one per production date (draft / submitted).
--   • mph_loss_report_departments — per department: the Authorized / Used / Net
--                                   MPH as they were when the report was saved.
--   • mph_loss_report_lines       — the reasons: department, reason, MPH lost,
--                                   workers affected, remarks.
--
-- When the first production entry for a date is posted, the report for that
-- date is opened and every production_coordinator is notified. The coordinator
-- (or a super admin) fills the reasons, and can only submit once every
-- department's loss is fully explained. A submitted report is locked; a super
-- admin can reopen it.
--
-- Report tables are read-only to clients; writes go through:
--   mph_loss_report_save(date, departments jsonb, lines jsonb, submit) → jsonb
--   mph_loss_report_reopen(report_id)                                 → void
--
-- Role: 20261102120000_production_coordinator_role.sql.
-- Rollback: supabase/rollbacks/20261102120100_mph_loss_reasons_down.sql
-- ============================================================================

-- 1. Reason master -------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.mph_loss_reason_code_seq;

CREATE TABLE IF NOT EXISTS public.mph_loss_reasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE
    DEFAULT 'MLR-' || lpad(nextval('public.mph_loss_reason_code_seq')::text, 2, '0'),
  name text NOT NULL,
  category text,
  description text,
  applies_to_all boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS mph_loss_reasons_name_uniq
  ON public.mph_loss_reasons (lower(btrim(name)));

CREATE TABLE IF NOT EXISTS public.mph_loss_reason_departments (
  reason_id uuid NOT NULL REFERENCES public.mph_loss_reasons(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  PRIMARY KEY (reason_id, department_id)
);

DROP TRIGGER IF EXISTS update_mph_loss_reasons_updated_at ON public.mph_loss_reasons;
CREATE TRIGGER update_mph_loss_reasons_updated_at
  BEFORE UPDATE ON public.mph_loss_reasons
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Everyone reads; only a super admin writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mph_loss_reasons', 'mph_loss_reason_departments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "Super admin writes %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Super admin writes %s" ON public.%I FOR ALL TO authenticated
                      USING (public.gate_pass_has_any_role(ARRAY[''super_admin'']))
                      WITH CHECK (public.gate_pass_has_any_role(ARRAY[''super_admin'']));', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.mph_loss_reason_code_seq TO authenticated, service_role;

-- Starting list (applies to every department; narrow it on the master page).
INSERT INTO public.mph_loss_reasons (name, category, description, sort_order)
SELECT v.name, v.category, v.description, v.sort_order
  FROM (VALUES
    ('Labour did not fulfil target',   'Labour',    'Workers present, output below process target', 1),
    ('Power shutdown',                 'Utilities', 'WAPDA / load shedding / generator delay',       2),
    ('Material shortage / late issue', 'Material',  'Material not issued from store on time',        3),
    ('Machine breakdown',              'Machine',   'Machine stopped, waiting for maintenance',      4),
    ('Extra manpower deployed',        'Labour',    'More workers than the job needed',              5),
    ('Quality rework',                 'Quality',   'Rejected pieces reworked, no new output',       6),
    ('Plan / order change',            'Planning',  'Job order changed mid-shift, setup time lost',  7),
    ('Indirect / support labour',      'Labour',    'Department has no MPH standard',                8)
  ) AS v(name, category, description, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.mph_loss_reasons);

-- 2. Reports -------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.mph_loss_report_seq;

CREATE TABLE IF NOT EXISTS public.mph_loss_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_number text NOT NULL UNIQUE
    DEFAULT 'MPHL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.mph_loss_report_seq')::text, 5, '0'),
  report_date date NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  total_authorized numeric NOT NULL DEFAULT 0,
  total_used numeric NOT NULL DEFAULT 0,
  total_loss numeric NOT NULL DEFAULT 0,
  notified_at timestamptz,
  -- Set when production is posted for the date after the report was submitted.
  production_changed_at timestamptz,
  submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitted_by_name text,
  submitted_at timestamptz,
  reopened_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reopened_by_name text,
  reopened_at timestamptz,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mph_loss_report_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.mph_loss_reports(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  department_name text,
  output numeric NOT NULL DEFAULT 0,
  authorized_mph numeric NOT NULL DEFAULT 0,
  used_mph numeric NOT NULL DEFAULT 0,
  net_mph numeric NOT NULL DEFAULT 0,
  UNIQUE (report_id, department_id)
);

CREATE TABLE IF NOT EXISTS public.mph_loss_report_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.mph_loss_reports(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  reason_id uuid NOT NULL REFERENCES public.mph_loss_reasons(id) ON DELETE RESTRICT,
  reason_name text NOT NULL,
  reason_category text,
  mph_lost numeric NOT NULL CHECK (mph_lost > 0),
  workers_affected integer CHECK (workers_affected IS NULL OR workers_affected >= 0),
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mph_loss_report_lines_report_idx ON public.mph_loss_report_lines (report_id, department_id);
CREATE INDEX IF NOT EXISTS mph_loss_report_lines_reason_idx ON public.mph_loss_report_lines (reason_id);

DROP TRIGGER IF EXISTS update_mph_loss_reports_updated_at ON public.mph_loss_reports;
CREATE TRIGGER update_mph_loss_reports_updated_at
  BEFORE UPDATE ON public.mph_loss_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Read for everyone with a login; no client writes (functions only).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mph_loss_reports', 'mph_loss_report_departments', 'mph_loss_report_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated;', t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

GRANT USAGE, SELECT ON SEQUENCE public.mph_loss_report_seq TO authenticated, service_role;

-- 3. Actions -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.mph_loss_can_edit()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(ARRAY['super_admin', 'production_coordinator']);
$$;

-- Save (draft) or submit the reasons for a production date.
--   p_departments: [{department_id, output, authorized_mph, used_mph, net_mph}]
--   p_lines:       [{department_id, reason_id, mph_lost, workers_affected, remarks}]
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

  DELETE FROM public.mph_loss_report_lines WHERE report_id = r.id;
  DELETE FROM public.mph_loss_report_departments WHERE report_id = r.id;

  FOR d IN SELECT * FROM jsonb_array_elements(COALESCE(p_departments, '[]'::jsonb)) LOOP
    INSERT INTO public.mph_loss_report_departments
      (report_id, department_id, department_name, output, authorized_mph, used_mph, net_mph)
    SELECT r.id, pd.id, pd.name,
           COALESCE((d->>'output')::numeric, 0),
           COALESCE((d->>'authorized_mph')::numeric, 0),
           COALESCE((d->>'used_mph')::numeric, 0),
           COALESCE((d->>'net_mph')::numeric, 0)
      FROM public.production_departments pd
     WHERE pd.id = (d->>'department_id')::uuid;
  END LOOP;

  FOR l IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_order := v_order + 1;
    v_dept := (l->>'department_id')::uuid;
    v_mph := NULLIF(l->>'mph_lost', '')::numeric;

    IF NOT EXISTS (SELECT 1 FROM public.mph_loss_report_departments
                    WHERE report_id = r.id AND department_id = v_dept) THEN
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
        ON ln.report_id = dd.report_id AND ln.department_id = dd.department_id
     WHERE dd.report_id = r.id AND dd.net_mph < 0
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
    total_authorized = COALESCE((SELECT sum(authorized_mph) FROM public.mph_loss_report_departments WHERE report_id = r.id), 0),
    total_used = COALESCE((SELECT sum(used_mph) FROM public.mph_loss_report_departments WHERE report_id = r.id), 0),
    total_loss = COALESCE((SELECT sum(-net_mph) FROM public.mph_loss_report_departments WHERE report_id = r.id AND net_mph < 0), 0),
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

-- A super admin reopens a submitted report so it can be corrected.
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

  PERFORM public.notify_role(ARRAY['production_coordinator']::app_role[],
    'MPH loss report reopened',
    r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY') || ' was reopened — check the reasons and submit again',
    'warning', 'labour', '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD'),
    'mph_loss_report', r.id, v_uid, v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) FROM public, anon;
REVOKE ALL ON FUNCTION public.mph_loss_report_reopen(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_save(date, jsonb, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mph_loss_report_reopen(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mph_loss_can_edit() TO authenticated;

-- 4. Production posted → open the day's report and notify the coordinator ------

CREATE OR REPLACE FUNCTION public.mph_loss_on_production_posted()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.mph_loss_reports%ROWTYPE;
  v_actor uuid := COALESCE(NEW.approved_by, NEW.created_by);
BEGIN
  IF NEW.status IS DISTINCT FROM 'Posted'
     OR (TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'Posted') THEN
    RETURN NEW;
  END IF;

  -- Never let the reasons workflow block posting production.
  BEGIN
    INSERT INTO public.mph_loss_reports (report_date, notified_at)
    VALUES (NEW.entry_date, now())
    ON CONFLICT (report_date) DO NOTHING
    RETURNING * INTO r;

    IF FOUND THEN
      PERFORM public.notify_role(ARRAY['production_coordinator']::app_role[],
        'MPH loss reasons due',
        'Production posted for ' || to_char(NEW.entry_date, 'DD Mon YYYY')
          || ' — give the reasons for departments in MPH loss',
        'warning', 'labour', '/labour/mph-loss-reasons?date=' || to_char(NEW.entry_date, 'YYYY-MM-DD'),
        'mph_loss_report', r.id, v_actor, NULL);
    ELSE
      -- Production changed after the reasons were submitted: flag it once.
      UPDATE public.mph_loss_reports
         SET production_changed_at = now()
       WHERE report_date = NEW.entry_date AND status = 'submitted' AND production_changed_at IS NULL
      RETURNING * INTO r;
      IF FOUND THEN
        PERFORM public.notify_role(ARRAY['production_coordinator', 'super_admin']::app_role[],
          'Production changed after MPH reasons were submitted',
          r.report_number || ' · ' || to_char(r.report_date, 'DD Mon YYYY')
            || ' — more production was posted; the MPH figures may no longer match the reasons',
          'warning', 'labour', '/labour/mph-loss-reasons?date=' || to_char(r.report_date, 'YYYY-MM-DD'),
          'mph_loss_report', r.id, v_actor, NULL);
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    RAISE WARNING 'mph_loss_on_production_posted: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mph_loss_on_production_posted ON public.production_entries;
CREATE TRIGGER trg_mph_loss_on_production_posted
  AFTER INSERT OR UPDATE OF status ON public.production_entries
  FOR EACH ROW EXECUTE FUNCTION public.mph_loss_on_production_posted();
