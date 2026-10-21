-- ============================================================================
-- Admin & Facilities — Office cleaning inspections (CLN-…)
-- ----------------------------------------------------------------------------
-- Areas (reception, washrooms, pantry, …) each use one checklist template and
-- are inspected on a frequency: daily, twice daily (morning + evening),
-- weekly (on a weekday) or monthly (on a day of the month).
--
--   * An inspection CLN-000001 is one area on one date (and shift). Lines are
--     copied from the area's template; each is ok / not_ok / na with a remark
--     and a photo (required on not_ok). Score = ok / (ok + not_ok).
--   * draft → submitted. On submit every not_ok line becomes an action item
--     assigned to the area's supervisor, due tomorrow; the supervisor closes
--     it with an "after" photo. A score below 70 % also tells the managers.
--   * One submitted inspection per area, date and shift.
--   * 09:00 Pakistan daily: managers and officers are told how many areas are
--     overdue (pg_cron job facilities-cleaning-overdue).
--
-- Who (facilities_can in 20261110120100_facilities_core.sql):
--   manage    templates, checkpoints, areas; reassign / close any action item
--   operate   start, fill, submit, cancel inspections
--   cleaning  close own action items (cleaning_supervisor and above)
--
-- Tables are read-only to clients: every write goes through the SECURITY
-- DEFINER facilities_* functions below. Every action is logged in
-- facilities_events (document_type 'inspection' / 'action_item').
-- Rollback: supabase/rollbacks/20261110120300_facilities_cleaning_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.facilities_inspection_number_seq;

CREATE TABLE IF NOT EXISTS public.facilities_cleaning_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facilities_cleaning_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.facilities_cleaning_templates(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_cleaning_checkpoints_template_idx
  ON public.facilities_cleaning_checkpoints (template_id, sort_order);

CREATE TABLE IF NOT EXISTS public.facilities_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  location text,
  template_id uuid NOT NULL REFERENCES public.facilities_cleaning_templates(id) ON DELETE RESTRICT,
  frequency text NOT NULL DEFAULT 'daily'
    CHECK (frequency IN ('daily','twice_daily','weekly','monthly')),
  -- weekly: 0 = Sunday … 6 = Saturday (ISO dow via extract(dow))
  due_weekday integer CHECK (due_weekday BETWEEN 0 AND 6),
  -- monthly: 1 … 28
  due_day integer CHECK (due_day BETWEEN 1 AND 28),
  supervisor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facilities_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_number text NOT NULL UNIQUE,
  area_id uuid NOT NULL REFERENCES public.facilities_areas(id) ON DELETE RESTRICT,
  inspection_date date NOT NULL DEFAULT public.facilities_today(),
  -- 'evening' only for twice-daily areas; 'morning' otherwise means "the day's inspection".
  shift text NOT NULL DEFAULT 'morning' CHECK (shift IN ('morning','evening')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  inspector_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  score numeric(5,2),
  ok_count integer NOT NULL DEFAULT 0,
  not_ok_count integer NOT NULL DEFAULT 0,
  na_count integer NOT NULL DEFAULT 0,
  remarks text,
  submitted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS facilities_inspections_submitted_once_idx
  ON public.facilities_inspections (area_id, inspection_date, shift) WHERE status = 'submitted';
CREATE INDEX IF NOT EXISTS facilities_inspections_area_date_idx
  ON public.facilities_inspections (area_id, inspection_date DESC);
CREATE INDEX IF NOT EXISTS facilities_inspections_status_idx
  ON public.facilities_inspections (status, inspection_date DESC);

CREATE TABLE IF NOT EXISTS public.facilities_inspection_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.facilities_inspections(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES public.facilities_cleaning_checkpoints(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  text text NOT NULL,
  result text CHECK (result IS NULL OR result IN ('ok','not_ok','na')),
  remark text,
  photo_path text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_inspection_lines_inspection_idx
  ON public.facilities_inspection_lines (inspection_id, sort_order);

CREATE TABLE IF NOT EXISTS public.facilities_cleaning_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inspection_id uuid NOT NULL REFERENCES public.facilities_inspections(id) ON DELETE CASCADE,
  line_id uuid REFERENCES public.facilities_inspection_lines(id) ON DELETE SET NULL,
  area_id uuid NOT NULL REFERENCES public.facilities_areas(id) ON DELETE RESTRICT,
  text text NOT NULL,
  assigned_to uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  due_date date NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  close_note text,
  after_photo_path text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_cleaning_actions_status_idx
  ON public.facilities_cleaning_actions (status, due_date);
CREATE INDEX IF NOT EXISTS facilities_cleaning_actions_assigned_idx
  ON public.facilities_cleaning_actions (assigned_to, status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_cleaning_templates','facilities_cleaning_checkpoints',
                           'facilities_areas','facilities_inspections','facilities_inspection_lines',
                           'facilities_cleaning_actions'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Masters -----------------------------------------------------------------

-- p_data: { name, is_active }
CREATE OR REPLACE FUNCTION public.facilities_cleaning_template_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_name text := NULLIF(btrim(p_data->>'name'), '');
  v_active boolean := COALESCE((p_data->>'is_active')::boolean, true);
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can change checklist templates.';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter the template name.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_cleaning_templates WHERE lower(name) = lower(v_name) AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'A template called % already exists.', v_name;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.facilities_cleaning_templates (name, is_active, created_by)
    VALUES (v_name, v_active, public.app_user_id()) RETURNING id INTO v_id;
  ELSE
    UPDATE public.facilities_cleaning_templates
       SET name = v_name, is_active = v_active, updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template not found.';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- p_data: { template_id, text, sort_order, is_active }
CREATE OR REPLACE FUNCTION public.facilities_cleaning_checkpoint_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_template uuid := NULLIF(p_data->>'template_id', '')::uuid;
  v_text text := NULLIF(btrim(p_data->>'text'), '');
  v_sort integer := COALESCE(NULLIF(p_data->>'sort_order', '')::integer, 0);
  v_active boolean := COALESCE((p_data->>'is_active')::boolean, true);
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can change checklist points.';
  END IF;
  IF v_text IS NULL THEN
    RAISE EXCEPTION 'Enter the checkpoint text.';
  END IF;
  IF v_id IS NULL THEN
    IF v_template IS NULL OR NOT EXISTS (SELECT 1 FROM public.facilities_cleaning_templates WHERE id = v_template) THEN
      RAISE EXCEPTION 'Choose the template.';
    END IF;
    INSERT INTO public.facilities_cleaning_checkpoints (template_id, text, sort_order, is_active)
    VALUES (v_template, v_text, v_sort, v_active) RETURNING id INTO v_id;
  ELSE
    UPDATE public.facilities_cleaning_checkpoints
       SET text = v_text, sort_order = v_sort, is_active = v_active, updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Checkpoint not found.';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- p_data: { code, name, location, template_id, frequency, due_weekday, due_day, supervisor_id, is_active }
CREATE OR REPLACE FUNCTION public.facilities_area_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_code text := upper(NULLIF(btrim(p_data->>'code'), ''));
  v_name text := NULLIF(btrim(p_data->>'name'), '');
  v_location text := NULLIF(btrim(p_data->>'location'), '');
  v_template uuid := NULLIF(p_data->>'template_id', '')::uuid;
  v_freq text := COALESCE(NULLIF(p_data->>'frequency', ''), 'daily');
  v_weekday integer := NULLIF(p_data->>'due_weekday', '')::integer;
  v_day integer := NULLIF(p_data->>'due_day', '')::integer;
  v_supervisor uuid := NULLIF(p_data->>'supervisor_id', '')::uuid;
  v_active boolean := COALESCE((p_data->>'is_active')::boolean, true);
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can change areas.';
  END IF;
  IF v_code IS NULL THEN
    RAISE EXCEPTION 'Enter the area code.';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter the area name.';
  END IF;
  IF v_template IS NULL OR NOT EXISTS (SELECT 1 FROM public.facilities_cleaning_templates WHERE id = v_template) THEN
    RAISE EXCEPTION 'Choose the checklist template.';
  END IF;
  IF v_freq NOT IN ('daily','twice_daily','weekly','monthly') THEN
    RAISE EXCEPTION 'Choose the frequency.';
  END IF;
  IF v_freq = 'weekly' THEN
    IF v_weekday IS NULL OR v_weekday NOT BETWEEN 0 AND 6 THEN
      RAISE EXCEPTION 'Choose the weekday for a weekly area.';
    END IF;
    v_day := NULL;
  ELSIF v_freq = 'monthly' THEN
    IF v_day IS NULL OR v_day NOT BETWEEN 1 AND 28 THEN
      RAISE EXCEPTION 'Choose the day of the month (1–28) for a monthly area.';
    END IF;
    v_weekday := NULL;
  ELSE
    v_weekday := NULL;
    v_day := NULL;
  END IF;
  IF v_supervisor IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = v_supervisor) THEN
    RAISE EXCEPTION 'Supervisor not found.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_areas WHERE code = v_code AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Area code % is already used.', v_code;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.facilities_areas
      (code, name, location, template_id, frequency, due_weekday, due_day, supervisor_id, is_active, created_by)
    VALUES (v_code, v_name, v_location, v_template, v_freq, v_weekday, v_day, v_supervisor, v_active, public.app_user_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.facilities_areas
       SET code = v_code, name = v_name, location = v_location, template_id = v_template,
           frequency = v_freq, due_weekday = v_weekday, due_day = v_day,
           supervisor_id = v_supervisor, is_active = v_active, updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Area not found.';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- 3. Inspections -------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_inspection_recalc(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_ok integer; v_bad integer; v_na integer;
BEGIN
  SELECT count(*) FILTER (WHERE result = 'ok'),
         count(*) FILTER (WHERE result = 'not_ok'),
         count(*) FILTER (WHERE result = 'na')
    INTO v_ok, v_bad, v_na
    FROM public.facilities_inspection_lines WHERE inspection_id = p_id;
  UPDATE public.facilities_inspections
     SET ok_count = v_ok, not_ok_count = v_bad, na_count = v_na,
         score = CASE WHEN v_ok + v_bad > 0 THEN round(100.0 * v_ok / (v_ok + v_bad), 2) ELSE NULL END,
         updated_at = now()
   WHERE id = p_id;
END;
$$;

-- Start (or reopen) the draft for an area on a date and shift. Lines are
-- copied from the area's template. Returns the inspection id.
CREATE OR REPLACE FUNCTION public.facilities_inspection_start(p_area_id uuid, p_date date DEFAULT NULL, p_shift text DEFAULT 'morning')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  a public.facilities_areas%ROWTYPE;
  v_date date := COALESCE(p_date, public.facilities_today());
  v_shift text := COALESCE(NULLIF(p_shift, ''), 'morning');
  v_id uuid;
  v_n integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Log in again to start an inspection.';
  END IF;
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to do cleaning inspections.';
  END IF;
  SELECT * INTO a FROM public.facilities_areas WHERE id = p_area_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Area not found.';
  END IF;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'Area % is not active.', a.name;
  END IF;
  IF v_date > public.facilities_today() THEN
    RAISE EXCEPTION 'The inspection date cannot be in the future.';
  END IF;
  IF v_shift NOT IN ('morning','evening') THEN
    RAISE EXCEPTION 'Choose the shift.';
  END IF;
  IF v_shift = 'evening' AND a.frequency <> 'twice_daily' THEN
    RAISE EXCEPTION '% is inspected once a day; there is no evening inspection.', a.name;
  END IF;

  -- An existing draft is reopened; a submitted one blocks a second.
  SELECT id INTO v_id FROM public.facilities_inspections
   WHERE area_id = p_area_id AND inspection_date = v_date AND shift = v_shift AND status = 'draft'
   ORDER BY created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_inspections
              WHERE area_id = p_area_id AND inspection_date = v_date AND shift = v_shift AND status = 'submitted') THEN
    RAISE EXCEPTION '% was already inspected on % (%).', a.name, to_char(v_date, 'DD Mon YYYY'), v_shift;
  END IF;

  INSERT INTO public.facilities_inspections (inspection_number, area_id, inspection_date, shift, inspector_id, created_by)
  VALUES ('NEW-' || gen_random_uuid()::text, p_area_id, v_date, v_shift, v_uid, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.facilities_inspection_lines (inspection_id, checkpoint_id, sort_order, text)
  SELECT v_id, c.id, c.sort_order, c.text
    FROM public.facilities_cleaning_checkpoints c
   WHERE c.template_id = a.template_id AND c.is_active
   ORDER BY c.sort_order, c.created_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'The checklist of % has no active points. Add some on Areas & checklists first.', a.name;
  END IF;

  UPDATE public.facilities_inspections
     SET inspection_number = 'CLN-' || lpad(nextval('public.facilities_inspection_number_seq')::text, 6, '0')
   WHERE id = v_id;
  PERFORM public.facilities_log('inspection', v_id, 'started', a.name || ' · ' || v_n || ' point(s)');
  RETURN v_id;
END;
$$;

-- Raise unless the caller may edit this draft.
CREATE OR REPLACE FUNCTION public.facilities_inspection_assert_editable(p_id uuid)
RETURNS public.facilities_inspections LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.facilities_inspections%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.facilities_inspections WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inspection not found.';
  END IF;
  IF r.status <> 'draft' THEN
    RAISE EXCEPTION 'Inspection % has been submitted and can no longer be changed.', r.inspection_number;
  END IF;
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to do cleaning inspections.';
  END IF;
  IF r.inspector_id IS DISTINCT FROM public.app_user_id() AND NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only the inspector who started this inspection or a facilities manager can change it.';
  END IF;
  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_inspection_save_line(
  p_line_id uuid, p_result text, p_remark text DEFAULT NULL, p_photo_path text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  l public.facilities_inspection_lines%ROWTYPE;
  r public.facilities_inspections%ROWTYPE;
  v_result text := NULLIF(p_result, '');
BEGIN
  SELECT * INTO l FROM public.facilities_inspection_lines WHERE id = p_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checklist line not found.';
  END IF;
  r := public.facilities_inspection_assert_editable(l.inspection_id);
  IF v_result IS NOT NULL AND v_result NOT IN ('ok','not_ok','na') THEN
    RAISE EXCEPTION 'Choose OK, Not OK or N/A.';
  END IF;
  UPDATE public.facilities_inspection_lines
     SET result = v_result, remark = NULLIF(btrim(p_remark), ''),
         photo_path = NULLIF(btrim(p_photo_path), ''), updated_at = now()
   WHERE id = p_line_id;
  PERFORM public.facilities_inspection_recalc(r.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_inspection_submit(p_id uuid, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_inspections%ROWTYPE;
  a public.facilities_areas%ROWTYPE;
  l record;
  v_missing integer;
  v_no_photo integer;
  v_action uuid;
  v_actions integer := 0;
  v_due date := public.facilities_today() + 1;
BEGIN
  r := public.facilities_inspection_assert_editable(p_id);
  SELECT * INTO a FROM public.facilities_areas WHERE id = r.area_id;

  SELECT count(*) FILTER (WHERE result IS NULL),
         count(*) FILTER (WHERE result = 'not_ok' AND NULLIF(photo_path, '') IS NULL)
    INTO v_missing, v_no_photo
    FROM public.facilities_inspection_lines WHERE inspection_id = p_id;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% point(s) still have no result.', v_missing;
  END IF;
  IF v_no_photo > 0 THEN
    RAISE EXCEPTION 'Take a photo of every point marked Not OK (% missing).', v_no_photo;
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_inspections
              WHERE area_id = r.area_id AND inspection_date = r.inspection_date AND shift = r.shift
                AND status = 'submitted' AND id <> p_id) THEN
    RAISE EXCEPTION '% was already inspected on % (%).', a.name, to_char(r.inspection_date, 'DD Mon YYYY'), r.shift;
  END IF;

  PERFORM public.facilities_inspection_recalc(p_id);
  UPDATE public.facilities_inspections
     SET status = 'submitted', submitted_at = now(), inspector_id = COALESCE(inspector_id, v_uid),
         remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id RETURNING * INTO r;

  FOR l IN SELECT * FROM public.facilities_inspection_lines
            WHERE inspection_id = p_id AND result = 'not_ok' ORDER BY sort_order LOOP
    INSERT INTO public.facilities_cleaning_actions
      (inspection_id, line_id, area_id, text, assigned_to, due_date, created_by)
    VALUES (p_id, l.id, r.area_id,
            a.name || ' · ' || l.text || COALESCE(' — ' || l.remark, ''),
            a.supervisor_id, v_due, v_uid)
    RETURNING id INTO v_action;
    v_actions := v_actions + 1;
    PERFORM public.facilities_log('action_item', v_action, 'created',
      'From ' || r.inspection_number || COALESCE(' · assigned to supervisor', ''));
  END LOOP;

  PERFORM public.facilities_log('inspection', p_id, 'submitted',
    'Score ' || COALESCE(r.score::text, '—') || ' % · ' || v_actions || ' action item(s)');

  IF v_actions > 0 AND a.supervisor_id IS NOT NULL THEN
    PERFORM public.facilities_notify_user(a.supervisor_id, 'Cleaning action items for ' || a.name,
      v_actions || ' point(s) failed in ' || r.inspection_number || ' · due ' || to_char(v_due, 'DD Mon'),
      '/facilities/cleaning/actions', 'inspection', p_id, 'warning');
  END IF;
  IF v_actions > 0 AND a.supervisor_id IS NULL THEN
    PERFORM public.facilities_notify_managers('Cleaning action items have no supervisor',
      a.name || ' has ' || v_actions || ' open point(s) from ' || r.inspection_number || ' and no supervisor set',
      '/facilities/cleaning/actions', 'inspection', p_id, 'warning');
  END IF;
  IF r.score IS NOT NULL AND r.score < 70 THEN
    PERFORM public.facilities_notify_managers('Low cleaning score: ' || a.name,
      r.inspection_number || ' scored ' || r.score || ' % (' || r.not_ok_count || ' not OK)',
      '/facilities/cleaning/' || p_id::text, 'inspection', p_id, 'warning');
  END IF;
  RETURN r.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_inspection_cancel_draft(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.facilities_inspections%ROWTYPE;
BEGIN
  r := public.facilities_inspection_assert_editable(p_id);
  DELETE FROM public.facilities_events WHERE document_type = 'inspection' AND document_id = p_id;
  DELETE FROM public.facilities_inspections WHERE id = p_id;
END;
$$;

-- 4. Action items --------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_cleaning_action_close(p_id uuid, p_note text DEFAULT NULL, p_after_photo_path text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_cleaning_actions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.facilities_cleaning_actions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action item not found.';
  END IF;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'This action item is already closed.';
  END IF;
  IF NOT (public.facilities_can('manage')
          OR (public.facilities_can('cleaning') AND r.assigned_to IS NOT DISTINCT FROM v_uid)) THEN
    RAISE EXCEPTION 'Only the person this item is assigned to or a facilities manager can close it.';
  END IF;
  IF NULLIF(btrim(p_after_photo_path), '') IS NULL THEN
    RAISE EXCEPTION 'Take an "after" photo to close the item.';
  END IF;
  UPDATE public.facilities_cleaning_actions
     SET status = 'closed', closed_by = v_uid, closed_at = now(),
         close_note = NULLIF(btrim(p_note), ''), after_photo_path = btrim(p_after_photo_path), updated_at = now()
   WHERE id = p_id;
  PERFORM public.facilities_log('action_item', p_id, 'closed', NULLIF(btrim(p_note), ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_cleaning_action_reassign(p_id uuid, p_user uuid, p_due_date date DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.facilities_cleaning_actions%ROWTYPE;
  v_name text;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can reassign action items.';
  END IF;
  SELECT * INTO r FROM public.facilities_cleaning_actions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Action item not found.';
  END IF;
  IF r.status <> 'open' THEN
    RAISE EXCEPTION 'This action item is already closed.';
  END IF;
  SELECT full_name INTO v_name FROM public.app_users WHERE id = p_user;
  IF p_user IS NOT NULL AND v_name IS NULL THEN
    RAISE EXCEPTION 'User not found.';
  END IF;
  UPDATE public.facilities_cleaning_actions
     SET assigned_to = p_user, due_date = COALESCE(p_due_date, due_date), updated_at = now()
   WHERE id = p_id;
  PERFORM public.facilities_log('action_item', p_id, 'reassigned',
    COALESCE('To ' || v_name, 'Unassigned') || COALESCE(' · due ' || to_char(p_due_date, 'DD Mon'), ''));
  PERFORM public.facilities_notify_user(p_user, 'Cleaning action item assigned to you',
    r.text || ' · due ' || to_char(COALESCE(p_due_date, r.due_date), 'DD Mon'),
    '/facilities/cleaning/actions', 'action_item', p_id, 'info');
END;
$$;

-- 5. Daily overdue reminder -----------------------------------------------------

-- Areas that should have been inspected by now and have no submitted inspection.
CREATE OR REPLACE FUNCTION public.facilities_cleaning_overdue_count(p_date date DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_date date := COALESCE(p_date, public.facilities_today());
  v_dow integer := extract(dow FROM v_date)::integer;
  v_day integer := extract(day FROM v_date)::integer;
  v_n integer;
BEGIN
  SELECT count(*) INTO v_n
    FROM public.facilities_areas a
   WHERE a.is_active
     AND (
       (a.frequency IN ('daily','twice_daily')
          AND NOT EXISTS (SELECT 1 FROM public.facilities_inspections i
                           WHERE i.area_id = a.id AND i.inspection_date = v_date AND i.status = 'submitted'))
       OR (a.frequency = 'weekly' AND a.due_weekday = v_dow
          AND NOT EXISTS (SELECT 1 FROM public.facilities_inspections i
                           WHERE i.area_id = a.id AND i.inspection_date = v_date AND i.status = 'submitted'))
       OR (a.frequency = 'monthly' AND a.due_day = v_day
          AND NOT EXISTS (SELECT 1 FROM public.facilities_inspections i
                           WHERE i.area_id = a.id AND i.inspection_date = v_date AND i.status = 'submitted'))
     );
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_cleaning_notify_overdue()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_n integer := public.facilities_cleaning_overdue_count();
BEGIN
  IF v_n > 0 THEN
    PERFORM public.notify_role(ARRAY['super_admin','facilities_manager','facilities_officer']::app_role[],
      'Cleaning inspections due today',
      v_n || ' area(s) are due for a cleaning inspection today and not yet done.',
      'warning', 'facilities', '/facilities/cleaning', NULL, NULL, NULL, NULL);
  END IF;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-cleaning-overdue';
    -- 04:00 UTC = 09:00 in Pakistan.
    PERFORM cron.schedule('facilities-cleaning-overdue', '0 4 * * *', 'SELECT public.facilities_cleaning_notify_overdue()');
  END IF;
END $$;

-- 6. Seed templates ------------------------------------------------------------

DO $$
DECLARE v_t uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.facilities_cleaning_templates WHERE name = 'Washroom') THEN
    INSERT INTO public.facilities_cleaning_templates (name) VALUES ('Washroom') RETURNING id INTO v_t;
    INSERT INTO public.facilities_cleaning_checkpoints (template_id, sort_order, text) VALUES
      (v_t, 1, 'Floor swept & mopped, dry'),
      (v_t, 2, 'Bins emptied, liner replaced'),
      (v_t, 3, 'Soap, tissue, hand towel stocked'),
      (v_t, 4, 'Mirrors & taps clean, no stains'),
      (v_t, 5, 'No odour · exhaust working'),
      (v_t, 6, 'Flush & drains working');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities_cleaning_templates WHERE name = 'Office area') THEN
    INSERT INTO public.facilities_cleaning_templates (name) VALUES ('Office area') RETURNING id INTO v_t;
    INSERT INTO public.facilities_cleaning_checkpoints (template_id, sort_order, text) VALUES
      (v_t, 1, 'Floor clean'),
      (v_t, 2, 'Desks & surfaces dusted'),
      (v_t, 3, 'Bins emptied'),
      (v_t, 4, 'Windows & glass clean'),
      (v_t, 5, 'AC filters / vents clean');
  END IF;
END $$;

-- 7. Grants ----------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_cleaning_template_save(uuid, jsonb),
  public.facilities_cleaning_checkpoint_save(uuid, jsonb),
  public.facilities_area_save(uuid, jsonb),
  public.facilities_inspection_recalc(uuid),
  public.facilities_inspection_start(uuid, date, text),
  public.facilities_inspection_assert_editable(uuid),
  public.facilities_inspection_save_line(uuid, text, text, text),
  public.facilities_inspection_submit(uuid, text),
  public.facilities_inspection_cancel_draft(uuid),
  public.facilities_cleaning_action_close(uuid, text, text),
  public.facilities_cleaning_action_reassign(uuid, uuid, date),
  public.facilities_cleaning_overdue_count(date),
  public.facilities_cleaning_notify_overdue()
  TO anon, authenticated, service_role;
