-- ============================================================================
-- Admin & Facilities — Security cameras: masters and the daily check
-- ----------------------------------------------------------------------------
-- Cameras and recorders (NVR / DVR) are masters. ONE check per calendar day
-- (CCK-000001, …): its lines are generated from every active camera, each gets
-- a result (ok / blurry / offline / damaged / no_recording / wrong_angle), and
-- every recorder is checked too (recording, days of footage, HDD, clock).
--
--   draft (whoever may operate fills it, on the phone)
--     → submitted (locked; counts) → reviewed (a facilities manager)
--
-- A line that is not ok creates or re-opens an equipment ticket through
-- facilities_ticket_from_camera() when that function exists (equipment
-- sub-module); until then the fault is only on the check.
-- A daily cron reports a missing check after facilities_settings.
-- camera_check_alarm_time (Pakistan time).
--
-- Tables are read-only to clients; writes go through the facilities_* functions
-- below (role via facilities_can). Core: 20261110120100_facilities_core.sql.
-- Rollback: supabase/rollbacks/20261110120200_facilities_cameras_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.facilities_camera_check_number_seq;

CREATE TABLE IF NOT EXISTS public.facilities_recorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  channels integer NOT NULL DEFAULT 16 CHECK (channels > 0),
  expected_retention_days integer NOT NULL DEFAULT 30 CHECK (expected_retention_days >= 0),
  location text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facilities_cameras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  zone text,
  recorder_id uuid REFERENCES public.facilities_recorders(id) ON DELETE SET NULL,
  channel_no integer CHECK (channel_no IS NULL OR channel_no > 0),
  ip_address text,
  fixed_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_cameras_order_idx ON public.facilities_cameras (is_active, sort_order, code);

CREATE TABLE IF NOT EXISTS public.facilities_camera_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_number text NOT NULL UNIQUE,
  check_date date NOT NULL DEFAULT public.facilities_today(),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','reviewed')),
  camera_count integer NOT NULL DEFAULT 0,
  ok_count integer NOT NULL DEFAULT 0,
  fault_count integer NOT NULL DEFAULT 0,
  recorder_fault_count integer NOT NULL DEFAULT 0,
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_remarks text
);
-- One check per day.
CREATE UNIQUE INDEX IF NOT EXISTS facilities_camera_checks_date_idx ON public.facilities_camera_checks (check_date);

CREATE TABLE IF NOT EXISTS public.facilities_camera_check_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.facilities_camera_checks(id) ON DELETE CASCADE,
  camera_id uuid NOT NULL REFERENCES public.facilities_cameras(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  result text CHECK (result IS NULL OR result IN ('ok','blurry','offline','damaged','no_recording','wrong_angle')),
  remark text,
  photo_path text,
  ticket_id uuid,
  UNIQUE (check_id, camera_id)
);
CREATE INDEX IF NOT EXISTS facilities_camera_check_lines_camera_idx ON public.facilities_camera_check_lines (camera_id, result);

CREATE TABLE IF NOT EXISTS public.facilities_camera_check_recorders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id uuid NOT NULL REFERENCES public.facilities_camera_checks(id) ON DELETE CASCADE,
  recorder_id uuid NOT NULL REFERENCES public.facilities_recorders(id) ON DELETE RESTRICT,
  is_recording boolean,
  footage_days integer CHECK (footage_days IS NULL OR footage_days >= 0),
  hdd_status text CHECK (hdd_status IS NULL OR hdd_status IN ('ok','warning','failed')),
  clock_ok boolean,
  remark text,
  UNIQUE (check_id, recorder_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_recorders','facilities_cameras','facilities_camera_checks',
                           'facilities_camera_check_lines','facilities_camera_check_recorders'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Masters -----------------------------------------------------------------

-- p_data: { code, name, channels, expected_retention_days, location, is_active }
CREATE OR REPLACE FUNCTION public.facilities_recorder_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_code text := NULLIF(btrim(p_data->>'code'), '');
  v_name text := NULLIF(btrim(p_data->>'name'), '');
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can change the recorders.';
  END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Enter the recorder code (for example NVR-1).'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Enter the recorder name.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.facilities_recorders (code, name, channels, expected_retention_days, location, is_active)
    VALUES (v_code, v_name, COALESCE(NULLIF(p_data->>'channels','')::integer, 16),
            COALESCE(NULLIF(p_data->>'expected_retention_days','')::integer, 30),
            NULLIF(btrim(p_data->>'location'), ''), COALESCE((p_data->>'is_active')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.facilities_recorders SET
      code = v_code, name = v_name,
      channels = COALESCE(NULLIF(p_data->>'channels','')::integer, channels),
      expected_retention_days = COALESCE(NULLIF(p_data->>'expected_retention_days','')::integer, expected_retention_days),
      location = NULLIF(btrim(p_data->>'location'), ''),
      is_active = COALESCE((p_data->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Recorder not found.'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A recorder with code % already exists.', v_code;
END;
$$;

-- p_data: { code, name, zone, recorder_id, channel_no, ip_address, fixed_asset_id, sort_order, is_active }
CREATE OR REPLACE FUNCTION public.facilities_camera_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_code text := NULLIF(btrim(p_data->>'code'), '');
  v_name text := NULLIF(btrim(p_data->>'name'), '');
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can change the cameras.';
  END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Enter the camera code (for example CAM-01).'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Enter the camera name (where it looks).'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.facilities_cameras (code, name, zone, recorder_id, channel_no, ip_address, fixed_asset_id, sort_order, is_active)
    VALUES (v_code, v_name, NULLIF(btrim(p_data->>'zone'), ''),
            NULLIF(p_data->>'recorder_id','')::uuid, NULLIF(p_data->>'channel_no','')::integer,
            NULLIF(btrim(p_data->>'ip_address'), ''), NULLIF(p_data->>'fixed_asset_id','')::uuid,
            COALESCE(NULLIF(p_data->>'sort_order','')::integer, 0), COALESCE((p_data->>'is_active')::boolean, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.facilities_cameras SET
      code = v_code, name = v_name, zone = NULLIF(btrim(p_data->>'zone'), ''),
      recorder_id = NULLIF(p_data->>'recorder_id','')::uuid,
      channel_no = NULLIF(p_data->>'channel_no','')::integer,
      ip_address = NULLIF(btrim(p_data->>'ip_address'), ''),
      fixed_asset_id = NULLIF(p_data->>'fixed_asset_id','')::uuid,
      sort_order = COALESCE(NULLIF(p_data->>'sort_order','')::integer, sort_order),
      is_active = COALESCE((p_data->>'is_active')::boolean, is_active),
      updated_at = now()
    WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Camera not found.'; END IF;
  END IF;
  RETURN v_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A camera with code % already exists.', v_code;
END;
$$;

-- 3. The daily check -----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_camera_result_label(p_result text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_result
    WHEN 'ok' THEN 'OK' WHEN 'blurry' THEN 'Blurry' WHEN 'offline' THEN 'Offline'
    WHEN 'damaged' THEN 'Damaged' WHEN 'no_recording' THEN 'Not recording'
    WHEN 'wrong_angle' THEN 'Wrong angle' ELSE COALESCE(p_result, '—') END;
$$;

-- Start today's (or p_date's) check, or return the one that already exists.
-- Lines come from every active camera and recorder.
CREATE OR REPLACE FUNCTION public.facilities_camera_check_start(p_date date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_date date := COALESCE(p_date, public.facilities_today());
  v_id uuid;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to do the camera check.';
  END IF;
  IF v_date > public.facilities_today() THEN
    RAISE EXCEPTION 'A camera check cannot be started for a future date.';
  END IF;
  SELECT id INTO v_id FROM public.facilities_camera_checks WHERE check_date = v_date;
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities_cameras WHERE is_active) THEN
    RAISE EXCEPTION 'No active cameras are set up. Add them on Cameras & Recorders first.';
  END IF;

  INSERT INTO public.facilities_camera_checks (check_number, check_date, created_by)
  VALUES ('CCK-' || lpad(nextval('public.facilities_camera_check_number_seq')::text, 6, '0'), v_date, v_uid)
  RETURNING id INTO v_id;

  INSERT INTO public.facilities_camera_check_lines (check_id, camera_id, sort_order)
  SELECT v_id, c.id, row_number() OVER (ORDER BY c.sort_order, c.code)
    FROM public.facilities_cameras c WHERE c.is_active;
  INSERT INTO public.facilities_camera_check_recorders (check_id, recorder_id)
  SELECT v_id, r.id FROM public.facilities_recorders r WHERE r.is_active;

  UPDATE public.facilities_camera_checks
     SET camera_count = (SELECT count(*) FROM public.facilities_camera_check_lines WHERE check_id = v_id)
   WHERE id = v_id;
  PERFORM public.facilities_log('camera_check', v_id, 'started', 'Check started');
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_camera_check_assert_draft(p_check_id uuid)
RETURNS public.facilities_camera_checks LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_chk public.facilities_camera_checks%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to do the camera check.';
  END IF;
  SELECT * INTO v_chk FROM public.facilities_camera_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Camera check not found.'; END IF;
  IF v_chk.status <> 'draft' THEN
    RAISE EXCEPTION 'Camera check % is already % and can no longer be changed.', v_chk.check_number, v_chk.status;
  END IF;
  RETURN v_chk;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_camera_check_save_line(
  p_line_id uuid, p_result text, p_remark text DEFAULT NULL, p_photo_path text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_line public.facilities_camera_check_lines%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM public.facilities_camera_check_lines WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Camera line not found.'; END IF;
  PERFORM public.facilities_camera_check_assert_draft(v_line.check_id);
  IF p_result IS NULL OR p_result NOT IN ('ok','blurry','offline','damaged','no_recording','wrong_angle') THEN
    RAISE EXCEPTION 'Choose the camera''s result.';
  END IF;
  UPDATE public.facilities_camera_check_lines
     SET result = p_result, remark = NULLIF(btrim(p_remark), ''), photo_path = NULLIF(btrim(p_photo_path), '')
   WHERE id = p_line_id;
  UPDATE public.facilities_camera_checks SET updated_at = now() WHERE id = v_line.check_id;
END;
$$;

-- p_data: { is_recording, footage_days, hdd_status, clock_ok, remark }
CREATE OR REPLACE FUNCTION public.facilities_camera_check_save_recorder(p_line_id uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_line public.facilities_camera_check_recorders%ROWTYPE;
BEGIN
  SELECT * INTO v_line FROM public.facilities_camera_check_recorders WHERE id = p_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recorder line not found.'; END IF;
  PERFORM public.facilities_camera_check_assert_draft(v_line.check_id);
  UPDATE public.facilities_camera_check_recorders SET
    is_recording = (p_data->>'is_recording')::boolean,
    footage_days = NULLIF(p_data->>'footage_days','')::integer,
    hdd_status = NULLIF(p_data->>'hdd_status',''),
    clock_ok = (p_data->>'clock_ok')::boolean,
    remark = NULLIF(btrim(p_data->>'remark'), '')
  WHERE id = p_line_id;
  UPDATE public.facilities_camera_checks SET updated_at = now() WHERE id = v_line.check_id;
END;
$$;

-- Submit: every camera needs a result; every recorder needs the recording
-- answer. Faults create / re-open equipment tickets when that sub-module is
-- installed. Managers are told when there are faults.
CREATE OR REPLACE FUNCTION public.facilities_camera_check_submit(p_check_id uuid, p_remarks text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_chk public.facilities_camera_checks%ROWTYPE;
  v_missing integer;
  v_ok integer;
  v_fault integer;
  v_rec_fault integer;
  v_has_tickets boolean := to_regprocedure('public.facilities_ticket_from_camera(uuid,uuid,text,text)') IS NOT NULL;
  r record;
  v_ticket uuid;
  v_faults text;
BEGIN
  v_chk := public.facilities_camera_check_assert_draft(p_check_id);

  SELECT count(*) FILTER (WHERE result IS NULL), count(*) FILTER (WHERE result = 'ok'),
         count(*) FILTER (WHERE result IS NOT NULL AND result <> 'ok')
    INTO v_missing, v_ok, v_fault
    FROM public.facilities_camera_check_lines WHERE check_id = p_check_id;
  IF v_missing > 0 THEN
    RAISE EXCEPTION '% camera(s) still have no result.', v_missing;
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_camera_check_recorders WHERE check_id = p_check_id AND is_recording IS NULL) THEN
    RAISE EXCEPTION 'Answer "Recording?" for every recorder.';
  END IF;
  SELECT count(*) INTO v_rec_fault FROM public.facilities_camera_check_recorders
   WHERE check_id = p_check_id
     AND (NOT is_recording OR hdd_status IN ('warning','failed') OR clock_ok = false);

  IF v_has_tickets THEN
    FOR r IN
      SELECT l.id, l.camera_id, l.result, l.remark
        FROM public.facilities_camera_check_lines l
       WHERE l.check_id = p_check_id AND l.result <> 'ok'
    LOOP
      EXECUTE 'SELECT public.facilities_ticket_from_camera($1, $2, $3, $4)'
         INTO v_ticket USING r.camera_id, p_check_id, r.result, r.remark;
      UPDATE public.facilities_camera_check_lines SET ticket_id = v_ticket WHERE id = r.id;
    END LOOP;
  END IF;

  UPDATE public.facilities_camera_checks SET
    status = 'submitted', ok_count = v_ok, fault_count = v_fault, recorder_fault_count = v_rec_fault,
    remarks = NULLIF(btrim(p_remarks), ''), submitted_by = v_uid, submitted_at = now(), updated_at = now()
  WHERE id = p_check_id;
  PERFORM public.facilities_log('camera_check', p_check_id, 'submitted',
    format('Submitted: %s ok, %s fault(s), %s recorder issue(s)', v_ok, v_fault, v_rec_fault));

  IF v_fault > 0 OR v_rec_fault > 0 THEN
    SELECT string_agg(c.code || ' ' || public.facilities_camera_result_label(l.result), ', ' ORDER BY l.sort_order)
      INTO v_faults
      FROM public.facilities_camera_check_lines l JOIN public.facilities_cameras c ON c.id = l.camera_id
     WHERE l.check_id = p_check_id AND l.result <> 'ok';
    PERFORM public.facilities_notify_managers(
      'Camera check ' || v_chk.check_number || ': ' || v_fault || ' fault(s)',
      COALESCE(v_faults, '') || CASE WHEN v_rec_fault > 0 THEN ' · ' || v_rec_fault || ' recorder issue(s)' ELSE '' END,
      '/facilities/cameras/checks/' || p_check_id::text, 'camera_check', p_check_id, 'warning');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_camera_check_review(p_check_id uuid, p_remarks text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_chk public.facilities_camera_checks%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can review a camera check.';
  END IF;
  SELECT * INTO v_chk FROM public.facilities_camera_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Camera check not found.'; END IF;
  IF v_chk.status <> 'submitted' THEN
    RAISE EXCEPTION 'Only a submitted check can be reviewed.';
  END IF;
  UPDATE public.facilities_camera_checks
     SET status = 'reviewed', reviewed_by = public.app_user_id(), reviewed_at = now(),
         review_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_check_id;
  PERFORM public.facilities_log('camera_check', p_check_id, 'reviewed', COALESCE('Reviewed: ' || NULLIF(btrim(p_remarks), ''), 'Reviewed'));
END;
$$;

-- Delete an empty / abandoned draft (manage) so the day can be restarted.
CREATE OR REPLACE FUNCTION public.facilities_camera_check_discard(p_check_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_chk public.facilities_camera_checks%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can discard a draft check.';
  END IF;
  SELECT * INTO v_chk FROM public.facilities_camera_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Camera check not found.'; END IF;
  IF v_chk.status <> 'draft' THEN RAISE EXCEPTION 'Only a draft can be discarded.'; END IF;
  DELETE FROM public.facilities_events WHERE document_type = 'camera_check' AND document_id = p_check_id;
  DELETE FROM public.facilities_camera_checks WHERE id = p_check_id;
END;
$$;

-- 4. Missed-check alarm (cron, every 30 minutes) ---------------------------------
-- After the alarm time, if today has no submitted check, tell the managers and
-- officers once per day.

CREATE TABLE IF NOT EXISTS public.facilities_camera_check_alarms (
  alarm_date date PRIMARY KEY,
  sent_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.facilities_camera_check_alarms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read facilities_camera_check_alarms" ON public.facilities_camera_check_alarms;
CREATE POLICY "Read facilities_camera_check_alarms" ON public.facilities_camera_check_alarms FOR SELECT TO public USING (true);
GRANT SELECT ON public.facilities_camera_check_alarms TO anon, authenticated, service_role;
GRANT ALL ON public.facilities_camera_check_alarms TO service_role;

CREATE OR REPLACE FUNCTION public.facilities_camera_check_notify_missed()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := public.facilities_today();
  v_now time := (now() AT TIME ZONE 'Asia/Karachi')::time;
  v_alarm time;
BEGIN
  SELECT camera_check_alarm_time INTO v_alarm FROM public.facilities_settings WHERE id;
  IF v_now < v_alarm THEN RETURN 0; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facilities_cameras WHERE is_active) THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_camera_checks WHERE check_date = v_today AND status <> 'draft') THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_camera_check_alarms WHERE alarm_date = v_today) THEN RETURN 0; END IF;
  INSERT INTO public.facilities_camera_check_alarms (alarm_date) VALUES (v_today);
  PERFORM public.notify_role(ARRAY['super_admin','facilities_manager','facilities_officer']::app_role[],
    'Camera check not done today',
    'No security camera check has been submitted for ' || to_char(v_today, 'DD Mon YYYY') || ' by ' || to_char(v_alarm, 'HH24:MI') || '.',
    'warning', 'facilities', '/facilities/cameras/checks', 'camera_check', NULL, NULL, NULL);
  RETURN 1;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-camera-check-missed';
    PERFORM cron.schedule('facilities-camera-check-missed', '*/30 * * * *', 'SELECT public.facilities_camera_check_notify_missed()');
  END IF;
END $$;

-- 5. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_recorder_save(uuid, jsonb),
  public.facilities_camera_save(uuid, jsonb),
  public.facilities_camera_result_label(text),
  public.facilities_camera_check_start(date),
  public.facilities_camera_check_assert_draft(uuid),
  public.facilities_camera_check_save_line(uuid, text, text, text),
  public.facilities_camera_check_save_recorder(uuid, jsonb),
  public.facilities_camera_check_submit(uuid, text),
  public.facilities_camera_check_review(uuid, text),
  public.facilities_camera_check_discard(uuid),
  public.facilities_camera_check_notify_missed()
  TO anon, authenticated, service_role;
