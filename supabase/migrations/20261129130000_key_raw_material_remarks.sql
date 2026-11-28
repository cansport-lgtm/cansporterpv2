-- ============================================================================
-- Key Raw Material daily remarks
--
-- The store manager (material_consumption_manager) writes one summary remark
-- per day about the usage of the key raw materials and submits it. A super
-- admin approves (or rejects with a reason). Approved remarks are locked and
-- stored; a super admin can reopen one, and every change is kept in history.
--
--   draft -> submitted -> approved
--               \-> rejected -> (edit) -> submitted ...
--   approved -> (reopen, super admin) -> draft
--
-- Deadlines (settings, Pakistan time; "day end" = midnight after report date):
--   reminder_hours (24)  after day end: store manager reminded (bell/push)
--   submit_hours   (48)  after day end: not submitted -> super admins alerted
--   approve_hours  (48)  after submission: not approved -> super admins alerted
-- The check runs every 15 minutes; each open date is alerted once a day, at the
-- first run on or after alert_time, until it is submitted / approved. Only days
-- with production entries or stock closing count, and only from start_date.
--
-- Tables are read-only to clients (same pattern as consumption_key_raw_materials);
-- all writes go through the SECURITY DEFINER functions below.
--
-- Rollback: supabase/rollbacks/20261129130000_key_raw_material_remarks_down.sql
-- ============================================================================

-- 1. Settings -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consumption_key_rm_remark_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Karachi')::date,
  reminder_hours integer NOT NULL DEFAULT 24 CHECK (reminder_hours BETWEEN 1 AND 336),
  submit_hours integer NOT NULL DEFAULT 48 CHECK (submit_hours BETWEEN 1 AND 336),
  approve_hours integer NOT NULL DEFAULT 48 CHECK (approve_hours BETWEEN 1 AND 336),
  alert_time time NOT NULL DEFAULT '09:00',
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.consumption_key_rm_remark_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. Remarks + history ----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.consumption_key_rm_remarks (
  report_date date PRIMARY KEY,
  remarks text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  written_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.consumption_key_rm_remark_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('saved','submitted','approved','rejected','reopened')),
  status text NOT NULL,
  remarks text,
  note text,
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consumption_key_rm_remark_history_date_idx
  ON public.consumption_key_rm_remark_history (report_date, created_at);

-- Which (date, kind) has been alerted, and how many times.
CREATE TABLE IF NOT EXISTS public.consumption_key_rm_remark_alerts (
  report_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder','overdue','approval')),
  alert_count integer NOT NULL DEFAULT 0,
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_date, kind)
);

ALTER TABLE public.consumption_key_rm_remark_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_key_rm_remarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_key_rm_remark_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_key_rm_remark_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read consumption_key_rm_remark_settings" ON public.consumption_key_rm_remark_settings;
CREATE POLICY "Read consumption_key_rm_remark_settings" ON public.consumption_key_rm_remark_settings FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Read consumption_key_rm_remarks" ON public.consumption_key_rm_remarks;
CREATE POLICY "Read consumption_key_rm_remarks" ON public.consumption_key_rm_remarks FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Read consumption_key_rm_remark_history" ON public.consumption_key_rm_remark_history;
CREATE POLICY "Read consumption_key_rm_remark_history" ON public.consumption_key_rm_remark_history FOR SELECT TO public USING (true);

GRANT SELECT ON public.consumption_key_rm_remark_settings, public.consumption_key_rm_remarks,
  public.consumption_key_rm_remark_history TO anon, authenticated, service_role;
GRANT ALL ON public.consumption_key_rm_remark_settings, public.consumption_key_rm_remarks,
  public.consumption_key_rm_remark_history, public.consumption_key_rm_remark_alerts TO service_role;

-- 3. Helpers -------------------------------------------------------------------

-- Stable uuid per report date, used as the notification reference_id.
CREATE OR REPLACE FUNCTION public.key_rm_remark_ref(p_date date)
RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT md5('key_rm_remark:' || p_date::text)::uuid $$;

CREATE OR REPLACE FUNCTION public.key_rm_remark_clear_alerts(p_date date)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.notifications
     SET is_read = true, read_at = COALESCE(read_at, now())
   WHERE reference_type = 'key_rm_remark' AND reference_id = public.key_rm_remark_ref(p_date) AND NOT is_read;
$$;

CREATE OR REPLACE FUNCTION public.key_rm_remark_is_writer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.gate_pass_has_any_role(ARRAY['material_consumption_manager','super_admin']) $$;

-- 4. Per-day status (used by the UI and by the alert job) -----------------------
-- due_kind: reminder | overdue | approval | NULL (nothing outstanding)

CREATE OR REPLACE FUNCTION public.key_rm_remark_days(p_from date, p_to date)
RETURNS TABLE (
  report_date date, is_active boolean, status text,
  submitted_at timestamptz, reviewed_at timestamptz, due_kind text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.consumption_key_rm_remark_settings WHERE id),
  d AS (SELECT g::date AS report_date FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g)
  SELECT d.report_date,
         act.is_active,
         COALESCE(r.status, 'missing') AS status,
         r.submitted_at, r.reviewed_at,
         CASE
           WHEN NOT act.is_active OR d.report_date < s.start_date THEN NULL
           WHEN r.status = 'approved' THEN NULL
           WHEN r.status = 'submitted' THEN
             CASE WHEN r.submitted_at < now() - make_interval(hours => s.approve_hours) THEN 'approval' END
           WHEN now() >= ((d.report_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi') + make_interval(hours => s.submit_hours) THEN 'overdue'
           WHEN now() >= ((d.report_date + 1)::timestamp AT TIME ZONE 'Asia/Karachi') + make_interval(hours => s.reminder_hours) THEN 'reminder'
         END AS due_kind
    FROM d
    CROSS JOIN s
    LEFT JOIN public.consumption_key_rm_remarks r ON r.report_date = d.report_date
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM public.consumption_production_entry e WHERE e.entry_date = d.report_date)
          OR EXISTS (SELECT 1 FROM public.consumption_stock_closing c WHERE c.closing_date = d.report_date) AS is_active
    ) act
   ORDER BY d.report_date DESC;
$$;

-- 5. Writing, submitting, reviewing, reopening ----------------------------------

CREATE OR REPLACE FUNCTION public.key_rm_remark_save(p_date date, p_remarks text, p_submit boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_user_id();
  v_row public.consumption_key_rm_remarks%ROWTYPE;
  v_text text := btrim(COALESCE(p_remarks, ''));
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
BEGIN
  IF NOT public.key_rm_remark_is_writer() THEN
    RAISE EXCEPTION 'Only the store manager can write key raw material remarks.';
  END IF;
  IF p_date IS NULL OR p_date > v_today THEN
    RAISE EXCEPTION 'Remarks cannot be written for a future date.';
  END IF;
  IF p_submit AND v_text = '' THEN
    RAISE EXCEPTION 'Write the remarks before submitting.';
  END IF;

  SELECT * INTO v_row FROM public.consumption_key_rm_remarks WHERE report_date = p_date FOR UPDATE;
  IF FOUND AND v_row.status IN ('submitted','approved') THEN
    RAISE EXCEPTION 'These remarks are % and can no longer be edited.', v_row.status;
  END IF;

  INSERT INTO public.consumption_key_rm_remarks (report_date, remarks, status, written_by)
  VALUES (p_date, v_text, 'draft', v_user)
  ON CONFLICT (report_date) DO UPDATE
    SET remarks = EXCLUDED.remarks, status = 'draft', written_by = v_user, updated_at = now();
  INSERT INTO public.consumption_key_rm_remark_history (report_date, action, status, remarks, actor_id)
  VALUES (p_date, 'saved', 'draft', v_text, v_user);

  IF p_submit THEN
    UPDATE public.consumption_key_rm_remarks
       SET status = 'submitted', submitted_by = v_user, submitted_at = now(),
           reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, updated_at = now()
     WHERE report_date = p_date;
    INSERT INTO public.consumption_key_rm_remark_history (report_date, action, status, remarks, actor_id)
    VALUES (p_date, 'submitted', 'submitted', v_text, v_user);

    PERFORM public.key_rm_remark_clear_alerts(p_date);
    PERFORM public.notify_role(
      ARRAY['super_admin']::app_role[], 'Key RM remarks awaiting approval',
      'Key raw material remarks for ' || to_char(p_date, 'DD Mon YYYY') || ' were submitted and need your approval.',
      'warning', 'consumption', '/consumption/key-raw-materials?date=' || p_date::text,
      'key_rm_remark', public.key_rm_remark_ref(p_date), v_user, v_user);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.key_rm_remark_review(p_date date, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_user_id();
  v_row public.consumption_key_rm_remarks%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can approve key raw material remarks.';
  END IF;
  SELECT * INTO v_row FROM public.consumption_key_rm_remarks WHERE report_date = p_date FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'There are no submitted remarks for this date.';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the remarks.';
  END IF;

  UPDATE public.consumption_key_rm_remarks
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_user, reviewed_at = now(), review_note = v_note, updated_at = now()
   WHERE report_date = p_date;
  INSERT INTO public.consumption_key_rm_remark_history (report_date, action, status, remarks, note, actor_id)
  VALUES (p_date, CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
          CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END, v_row.remarks, v_note, v_user);

  PERFORM public.key_rm_remark_clear_alerts(p_date);
  IF NOT p_approve THEN
    PERFORM public.notify_role(
      ARRAY['material_consumption_manager']::app_role[], 'Key RM remarks rejected',
      'Remarks for ' || to_char(p_date, 'DD Mon YYYY') || ' were rejected: ' || v_note || ' Please correct and resubmit.',
      'error', 'consumption', '/consumption/key-raw-materials?date=' || p_date::text,
      'key_rm_remark', public.key_rm_remark_ref(p_date), v_user, v_user);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.key_rm_remark_reopen(p_date date, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_user_id();
  v_row public.consumption_key_rm_remarks%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can reopen approved remarks.';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for reopening the remarks.';
  END IF;
  SELECT * INTO v_row FROM public.consumption_key_rm_remarks WHERE report_date = p_date FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only approved remarks can be reopened.';
  END IF;

  UPDATE public.consumption_key_rm_remarks
     SET status = 'draft', review_note = 'Reopened: ' || v_note, updated_at = now()
   WHERE report_date = p_date;
  INSERT INTO public.consumption_key_rm_remark_history (report_date, action, status, remarks, note, actor_id)
  VALUES (p_date, 'reopened', 'draft', v_row.remarks, v_note, v_user);

  PERFORM public.notify_role(
    ARRAY['material_consumption_manager']::app_role[], 'Key RM remarks reopened',
    'Remarks for ' || to_char(p_date, 'DD Mon YYYY') || ' were reopened: ' || v_note || ' Please correct and resubmit.',
    'warning', 'consumption', '/consumption/key-raw-materials?date=' || p_date::text,
    'key_rm_remark', public.key_rm_remark_ref(p_date), v_user, v_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.key_rm_remark_settings_save(
  p_enabled boolean, p_start_date date, p_reminder_hours integer,
  p_submit_hours integer, p_approve_hours integer, p_alert_time time
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the remark alert settings.';
  END IF;
  IF p_reminder_hours IS NULL OR p_submit_hours IS NULL OR p_approve_hours IS NULL
     OR LEAST(p_reminder_hours, p_submit_hours, p_approve_hours) < 1
     OR GREATEST(p_reminder_hours, p_submit_hours, p_approve_hours) > 336 THEN
    RAISE EXCEPTION 'Hours must be between 1 and 336.';
  END IF;
  IF p_reminder_hours > p_submit_hours THEN
    RAISE EXCEPTION 'The reminder must come before the submission deadline.';
  END IF;
  UPDATE public.consumption_key_rm_remark_settings
     SET enabled = COALESCE(p_enabled, true),
         start_date = COALESCE(p_start_date, start_date),
         reminder_hours = p_reminder_hours, submit_hours = p_submit_hours, approve_hours = p_approve_hours,
         alert_time = COALESCE(p_alert_time, '09:00'),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 6. The daily check ------------------------------------------------------------
-- Runs every 15 minutes; a date is alerted at the first run on or after
-- alert_time on each Pakistan day, until it is submitted (or approved).

CREATE OR REPLACE FUNCTION public.key_rm_remark_notify_due()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.consumption_key_rm_remark_settings%ROWTYPE;
  r record;
  v_now_pk timestamp := now() AT TIME ZONE 'Asia/Karachi';
  v_label text;
  v_link text;
  v_n integer := 0;
BEGIN
  SELECT * INTO s FROM public.consumption_key_rm_remark_settings WHERE id;
  IF NOT FOUND OR NOT s.enabled OR v_now_pk::time < s.alert_time THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT d.report_date, d.due_kind, COALESCE(a.alert_count, 0) AS alert_count
      FROM public.key_rm_remark_days(GREATEST(s.start_date, v_now_pk::date - 60), v_now_pk::date - 1) d
      LEFT JOIN public.consumption_key_rm_remark_alerts a
        ON a.report_date = d.report_date AND a.kind = d.due_kind
     WHERE d.due_kind IS NOT NULL
       AND (a.report_date IS NULL OR (a.last_alerted_at AT TIME ZONE 'Asia/Karachi')::date < v_now_pk::date)
     ORDER BY d.report_date
  LOOP
    v_label := to_char(r.report_date, 'DD Mon YYYY');
    v_link := '/consumption/key-raw-materials?date=' || r.report_date::text;
    PERFORM public.key_rm_remark_clear_alerts(r.report_date);

    IF r.due_kind = 'reminder' THEN
      PERFORM public.notify_role(
        ARRAY['material_consumption_manager']::app_role[], 'Key RM remarks due',
        'Please write and submit the key raw material remarks for ' || v_label || '.',
        'warning', 'consumption', v_link, 'key_rm_remark', public.key_rm_remark_ref(r.report_date), NULL, NULL);
    ELSIF r.due_kind = 'overdue' THEN
      PERFORM public.notify_role(
        ARRAY['super_admin','material_consumption_manager']::app_role[], 'Key RM remarks overdue',
        'Day ' || (r.alert_count + 1) || ' · Key raw material remarks for ' || v_label
          || ' were not submitted within ' || s.submit_hours || ' hours.',
        'error', 'consumption', v_link, 'key_rm_remark', public.key_rm_remark_ref(r.report_date), NULL, NULL);
    ELSE
      PERFORM public.notify_role(
        ARRAY['super_admin']::app_role[], 'Key RM remarks awaiting approval',
        'Day ' || (r.alert_count + 1) || ' · Remarks for ' || v_label
          || ' have waited more than ' || s.approve_hours || ' hours for approval.',
        'error', 'consumption', v_link, 'key_rm_remark', public.key_rm_remark_ref(r.report_date), NULL, NULL);
    END IF;

    INSERT INTO public.consumption_key_rm_remark_alerts (report_date, kind, alert_count, last_alerted_at)
    VALUES (r.report_date, r.due_kind, 1, now())
    ON CONFLICT (report_date, kind) DO UPDATE
      SET alert_count = public.consumption_key_rm_remark_alerts.alert_count + 1, last_alerted_at = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'key-rm-remarks-due';
    PERFORM cron.schedule('key-rm-remarks-due', '*/15 * * * *', 'SELECT public.key_rm_remark_notify_due()');
  END IF;
END $$;

-- 7. Permissions ----------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.key_rm_remark_days(date, date),
  public.key_rm_remark_save(date, text, boolean),
  public.key_rm_remark_review(date, boolean, text),
  public.key_rm_remark_reopen(date, text),
  public.key_rm_remark_settings_save(boolean, date, integer, integer, integer, time)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.key_rm_remark_notify_due(),
  public.key_rm_remark_clear_alerts(date)
FROM PUBLIC, anon, authenticated;
