-- ============================================================================
-- Rejections & Wastages daily report
--
-- One report per day for all departments. The rejections manager adds remarks
-- and submits it by the next morning; a super admin approves (or rejects with a
-- reason) within 48 hours. Figures are frozen at submit, approved reports are
-- locked, and entries for a submitted or approved day cannot be changed until
-- a super admin reopens it. Every step is kept in history.
--
--   draft -> submitted -> approved
--               \-> rejected -> (edit) -> submitted ...
--   approved -> (reopen, super admin) -> draft
--
-- Deadlines (Pakistan time), all editable in settings:
--   reminder_time  (08:00) next morning: rejections manager reminded
--   submit_by_time (10:00) next morning: not submitted -> manager + super admins alerted
--   approve_hours  (48)    after submission: not approved -> super admins alerted
--   resubmit_hours (48)    after a reject / reopen: not re-submitted -> alerted
-- The check runs every 15 minutes. A date is alerted as soon as it is overdue,
-- then once a day at the first run on or after alert_time, until it is
-- submitted / approved. Only days with R&W entries count, and only from start_date.
--
-- Tables are read-only to clients; all writes go through SECURITY DEFINER
-- functions. Same pattern as key_raw_material_remarks.
--
-- Rollback: supabase/rollbacks/20261201120000_rw_daily_report_down.sql
-- ============================================================================

-- 1. Settings -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_daily_report_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT true,
  start_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Karachi')::date,
  reminder_time time NOT NULL DEFAULT '08:00',
  submit_by_time time NOT NULL DEFAULT '10:00',
  approve_hours integer NOT NULL DEFAULT 48 CHECK (approve_hours BETWEEN 1 AND 336),
  resubmit_hours integer NOT NULL DEFAULT 48 CHECK (resubmit_hours BETWEEN 1 AND 336),
  alert_time time NOT NULL DEFAULT '09:00',
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.rw_daily_report_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 2. Reports + history + alert log ---------------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_daily_reports (
  report_date date PRIMARY KEY,
  summary text NOT NULL DEFAULT '',
  biggest_loss_remark text NOT NULL DEFAULT '',
  action_plan text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected')),
  snapshot jsonb,                       -- figures frozen at submit
  due_from timestamptz,                 -- set on reject / reopen: re-submit clock starts here
  written_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rw_daily_report_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date date NOT NULL,
  action text NOT NULL CHECK (action IN ('saved','submitted','approved','rejected','reopened')),
  status text NOT NULL,
  remarks jsonb,
  note text,
  actor_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rw_daily_report_history_date_idx
  ON public.rw_daily_report_history (report_date, created_at);

CREATE TABLE IF NOT EXISTS public.rw_daily_report_alerts (
  report_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('reminder','overdue','approval')),
  alert_count integer NOT NULL DEFAULT 0,
  last_alerted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_date, kind)
);

ALTER TABLE public.rw_daily_report_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_daily_report_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rw_daily_report_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read rw_daily_report_settings" ON public.rw_daily_report_settings;
CREATE POLICY "Read rw_daily_report_settings" ON public.rw_daily_report_settings FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Read rw_daily_reports" ON public.rw_daily_reports;
CREATE POLICY "Read rw_daily_reports" ON public.rw_daily_reports FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Read rw_daily_report_history" ON public.rw_daily_report_history;
CREATE POLICY "Read rw_daily_report_history" ON public.rw_daily_report_history FOR SELECT TO public USING (true);

GRANT SELECT ON public.rw_daily_report_settings, public.rw_daily_reports,
  public.rw_daily_report_history TO anon, authenticated, service_role;
GRANT ALL ON public.rw_daily_report_settings, public.rw_daily_reports,
  public.rw_daily_report_history, public.rw_daily_report_alerts TO service_role;

-- 3. Helpers -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rw_daily_report_ref(p_date date)
RETURNS uuid LANGUAGE sql IMMUTABLE
AS $$ SELECT md5('rw_daily_report:' || p_date::text)::uuid $$;

CREATE OR REPLACE FUNCTION public.rw_daily_report_clear_alerts(p_date date)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  UPDATE public.notifications
     SET is_read = true, read_at = COALESCE(read_at, now())
   WHERE reference_type = 'rw_daily_report' AND reference_id = public.rw_daily_report_ref(p_date) AND NOT is_read;
$$;

CREATE OR REPLACE FUNCTION public.rw_daily_report_is_writer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.gate_pass_has_any_role(ARRAY['rejections_manager','super_admin']) $$;

-- 4. The figures for one day ----------------------------------------------------
-- Same numbers as the Analytics page, cut to one date. Used live while the
-- report is a draft, and stored as the snapshot on submit.

CREATE OR REPLACE FUNCTION public.rw_daily_report_figures(p_date date)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH u AS (
    SELECT 'rejection'::text AS kind, entry_date, department_id, reason_id, material_id,
           COALESCE(rejected_qty, 0) AS qty, COALESCE(total_cost, 0) AS cost
      FROM public.rw_rejections WHERE entry_date BETWEEN p_date - 6 AND p_date
    UNION ALL
    SELECT 'wastage', entry_date, department_id, reason_id, material_id,
           COALESCE(wasted_qty, 0), COALESCE(total_cost, 0)
      FROM public.rw_wastages WHERE entry_date BETWEEN p_date - 6 AND p_date
    UNION ALL
    SELECT 'leakage', entry_date, department_id, reason_id, material_id,
           COALESCE(leaked_qty, 0), COALESCE(total_cost, 0)
      FROM public.rw_leakages WHERE entry_date BETWEEN p_date - 6 AND p_date
  ),
  t AS (SELECT * FROM u WHERE entry_date = p_date),
  kinds AS (
    SELECT k.kind, COALESCE(sum(t.qty), 0) AS qty, COALESCE(sum(t.cost), 0) AS cost, count(t.kind) AS entries
      FROM (VALUES ('rejection'), ('wastage'), ('leakage')) k(kind)
      LEFT JOIN t ON t.kind = k.kind
     GROUP BY k.kind
  ),
  daily AS (
    SELECT g::date AS d, COALESCE(sum(u.cost), 0) AS total
      FROM generate_series((p_date - 6)::timestamp, p_date::timestamp, interval '1 day') g
      LEFT JOIN u ON u.entry_date = g::date
     GROUP BY g
  ),
  dept AS (
    SELECT COALESCE(pd.name, '—') AS department,
           COALESCE(sum(t.qty)  FILTER (WHERE t.kind = 'rejection'), 0) AS rejected_qty,
           COALESCE(sum(t.cost) FILTER (WHERE t.kind = 'rejection'), 0) AS rejection_cost,
           COALESCE(sum(t.qty)  FILTER (WHERE t.kind = 'wastage'), 0)   AS wastage_qty,
           COALESCE(sum(t.cost) FILTER (WHERE t.kind = 'wastage'), 0)   AS wastage_cost,
           COALESCE(sum(t.qty)  FILTER (WHERE t.kind = 'leakage'), 0)   AS leakage_qty,
           COALESCE(sum(t.cost) FILTER (WHERE t.kind = 'leakage'), 0)   AS leakage_cost,
           sum(t.cost) AS total_cost
      FROM t LEFT JOIN public.production_departments pd ON pd.id = t.department_id
     GROUP BY t.department_id, pd.name
  ),
  reasons AS (
    SELECT COALESCE(r.name, 'No reason recorded') AS reason, t.kind, sum(t.qty) AS qty, sum(t.cost) AS cost, count(*) AS entries
      FROM t LEFT JOIN public.rw_reasons r ON r.id = t.reason_id
     GROUP BY r.name, t.kind
     ORDER BY sum(t.cost) DESC LIMIT 10
  ),
  mats AS (
    SELECT COALESCE(hp1.name, hp2.name, '—') AS material, t.kind, sum(t.qty) AS qty, sum(t.cost) AS cost
      FROM t
      LEFT JOIN public.rw_materials m ON m.id = t.material_id
      LEFT JOIN public.hp_materials hp1 ON hp1.id = m.hp_material_id
      LEFT JOIN public.hp_materials hp2 ON hp2.id = t.material_id
     GROUP BY COALESCE(hp1.name, hp2.name, '—'), t.kind
     ORDER BY sum(t.cost) DESC LIMIT 5
  )
  SELECT jsonb_build_object(
    'date', p_date,
    'rejection', (SELECT to_jsonb(k) - 'kind' FROM kinds k WHERE kind = 'rejection'),
    'wastage',   (SELECT to_jsonb(k) - 'kind' FROM kinds k WHERE kind = 'wastage'),
    'leakage',   (SELECT to_jsonb(k) - 'kind' FROM kinds k WHERE kind = 'leakage'),
    'total_cost', (SELECT COALESCE(sum(cost), 0) FROM kinds),
    'prev_day_total', (SELECT total FROM daily WHERE d = p_date - 1),
    'avg_prev_days', (SELECT avg(total) FROM daily WHERE d < p_date AND total > 0),
    'trend', (SELECT jsonb_agg(jsonb_build_object('date', d, 'total', total) ORDER BY d) FROM daily),
    'departments', COALESCE((SELECT jsonb_agg(to_jsonb(dept) ORDER BY total_cost DESC) FROM dept), '[]'::jsonb),
    'reasons', COALESCE((SELECT jsonb_agg(to_jsonb(reasons) ORDER BY cost DESC) FROM reasons), '[]'::jsonb),
    'materials', COALESCE((SELECT jsonb_agg(to_jsonb(mats) ORDER BY cost DESC) FROM mats), '[]'::jsonb)
  );
$$;

-- 5. Per-day status (used by the UI and by the alert job) -----------------------
-- due_kind: reminder | overdue | approval | NULL (nothing outstanding)

CREATE OR REPLACE FUNCTION public.rw_daily_report_days(p_from date, p_to date)
RETURNS TABLE (
  report_date date, is_active boolean, status text, total_cost numeric,
  submitted_at timestamptz, reviewed_at timestamptz, due_kind text, due_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.rw_daily_report_settings WHERE id),
  d AS (SELECT g::date AS report_date FROM generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g)
  SELECT d.report_date,
         act.is_active,
         COALESCE(r.status, 'missing') AS status,
         act.total_cost,
         r.submitted_at, r.reviewed_at,
         CASE
           WHEN NOT act.is_active OR d.report_date < s.start_date THEN NULL
           WHEN r.status = 'approved' THEN NULL
           WHEN r.status = 'submitted' THEN
             CASE WHEN now() >= r.submitted_at + make_interval(hours => s.approve_hours) THEN 'approval' END
           WHEN r.due_from IS NOT NULL THEN
             CASE WHEN now() >= r.due_from + make_interval(hours => s.resubmit_hours) THEN 'overdue' END
           WHEN now() >= ((d.report_date + 1)::timestamp + s.submit_by_time) AT TIME ZONE 'Asia/Karachi' THEN 'overdue'
           WHEN now() >= ((d.report_date + 1)::timestamp + s.reminder_time) AT TIME ZONE 'Asia/Karachi' THEN 'reminder'
         END AS due_kind,
         CASE
           WHEN NOT act.is_active OR d.report_date < s.start_date OR r.status = 'approved' THEN NULL
           WHEN r.status = 'submitted' THEN r.submitted_at + make_interval(hours => s.approve_hours)
           WHEN r.due_from IS NOT NULL THEN r.due_from + make_interval(hours => s.resubmit_hours)
           ELSE ((d.report_date + 1)::timestamp + s.submit_by_time) AT TIME ZONE 'Asia/Karachi'
         END AS due_at
    FROM d
    CROSS JOIN s
    LEFT JOIN public.rw_daily_reports r ON r.report_date = d.report_date
    CROSS JOIN LATERAL (
      SELECT count(*) > 0 AS is_active, COALESCE(sum(c), 0) AS total_cost
        FROM (
          SELECT total_cost AS c FROM public.rw_rejections WHERE entry_date = d.report_date
          UNION ALL SELECT total_cost FROM public.rw_wastages WHERE entry_date = d.report_date
          UNION ALL SELECT total_cost FROM public.rw_leakages WHERE entry_date = d.report_date
        ) x
    ) act
   ORDER BY d.report_date DESC;
$$;

-- 6. Writing, submitting, reviewing, reopening ----------------------------------

CREATE OR REPLACE FUNCTION public.rw_daily_report_save(
  p_date date, p_summary text, p_biggest_loss_remark text, p_action_plan text, p_submit boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_user_id();
  v_row public.rw_daily_reports%ROWTYPE;
  v_sum text := btrim(COALESCE(p_summary, ''));
  v_big text := btrim(COALESCE(p_biggest_loss_remark, ''));
  v_act text := btrim(COALESCE(p_action_plan, ''));
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_remarks jsonb;
BEGIN
  IF NOT public.rw_daily_report_is_writer() THEN
    RAISE EXCEPTION 'Only the rejections manager can write the R&W daily report.';
  END IF;
  IF p_date IS NULL OR p_date > v_today THEN
    RAISE EXCEPTION 'A report cannot be written for a future date.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.rw_rejections WHERE entry_date = p_date
    UNION ALL SELECT 1 FROM public.rw_wastages WHERE entry_date = p_date
    UNION ALL SELECT 1 FROM public.rw_leakages WHERE entry_date = p_date
  ) THEN
    RAISE EXCEPTION 'There are no rejection, wastage or leakage entries for this date.';
  END IF;
  IF p_submit AND (v_sum = '' OR v_big = '') THEN
    RAISE EXCEPTION 'Write the summary and the remark on the biggest-loss department before submitting.';
  END IF;

  SELECT * INTO v_row FROM public.rw_daily_reports WHERE report_date = p_date FOR UPDATE;
  IF FOUND AND v_row.status IN ('submitted','approved') THEN
    RAISE EXCEPTION 'This report is % and can no longer be edited.', v_row.status;
  END IF;

  v_remarks := jsonb_build_object('summary', v_sum, 'biggest_loss_remark', v_big, 'action_plan', v_act);

  -- status stays 'rejected' while being edited so the rejection reason stays visible
  INSERT INTO public.rw_daily_reports (report_date, summary, biggest_loss_remark, action_plan, status, written_by)
  VALUES (p_date, v_sum, v_big, v_act, 'draft', v_user)
  ON CONFLICT (report_date) DO UPDATE
    SET summary = EXCLUDED.summary, biggest_loss_remark = EXCLUDED.biggest_loss_remark,
        action_plan = EXCLUDED.action_plan, written_by = v_user, updated_at = now();
  INSERT INTO public.rw_daily_report_history (report_date, action, status, remarks, actor_id)
  VALUES (p_date, 'saved', COALESCE(v_row.status, 'draft'), v_remarks, v_user);

  IF p_submit THEN
    UPDATE public.rw_daily_reports
       SET status = 'submitted', snapshot = public.rw_daily_report_figures(p_date),
           submitted_by = v_user, submitted_at = now(), due_from = NULL,
           reviewed_by = NULL, reviewed_at = NULL, review_note = NULL, updated_at = now()
     WHERE report_date = p_date;
    INSERT INTO public.rw_daily_report_history (report_date, action, status, remarks, actor_id)
    VALUES (p_date, 'submitted', 'submitted', v_remarks, v_user);

    PERFORM public.rw_daily_report_clear_alerts(p_date);
    PERFORM public.notify_role(
      ARRAY['super_admin']::app_role[], 'R&W daily report awaiting approval',
      'The Rejections & Wastages report for ' || to_char(p_date, 'DD Mon YYYY') || ' was submitted and needs your approval.',
      'warning', 'rejections_wastages', '/rejections/daily-report?date=' || p_date::text,
      'rw_daily_report', public.rw_daily_report_ref(p_date), v_user, v_user);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rw_daily_report_review(p_date date, p_approve boolean, p_note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_user_id();
  v_row public.rw_daily_reports%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can approve the R&W daily report.';
  END IF;
  SELECT * INTO v_row FROM public.rw_daily_reports WHERE report_date = p_date FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'submitted' THEN
    RAISE EXCEPTION 'There is no submitted report for this date.';
  END IF;
  IF NOT p_approve AND v_note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the report.';
  END IF;

  UPDATE public.rw_daily_reports
     SET status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         reviewed_by = v_user, reviewed_at = now(), review_note = v_note,
         due_from = CASE WHEN p_approve THEN NULL ELSE now() END, updated_at = now()
   WHERE report_date = p_date;
  INSERT INTO public.rw_daily_report_history (report_date, action, status, remarks, note, actor_id)
  VALUES (p_date, CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
          CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
          jsonb_build_object('summary', v_row.summary, 'biggest_loss_remark', v_row.biggest_loss_remark, 'action_plan', v_row.action_plan),
          v_note, v_user);

  PERFORM public.rw_daily_report_clear_alerts(p_date);
  IF NOT p_approve THEN
    PERFORM public.notify_role(
      ARRAY['rejections_manager']::app_role[], 'R&W daily report rejected',
      'The report for ' || to_char(p_date, 'DD Mon YYYY') || ' was rejected: ' || v_note || ' Please correct and resubmit.',
      'error', 'rejections_wastages', '/rejections/daily-report?date=' || p_date::text,
      'rw_daily_report', public.rw_daily_report_ref(p_date), v_user, v_user);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rw_daily_report_reopen(p_date date, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := public.app_user_id();
  v_row public.rw_daily_reports%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can reopen an approved report.';
  END IF;
  IF v_note IS NULL THEN
    RAISE EXCEPTION 'Give a reason for reopening the report.';
  END IF;
  SELECT * INTO v_row FROM public.rw_daily_reports WHERE report_date = p_date FOR UPDATE;
  IF NOT FOUND OR v_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved report can be reopened.';
  END IF;

  UPDATE public.rw_daily_reports
     SET status = 'draft', review_note = 'Reopened: ' || v_note, due_from = now(), updated_at = now()
   WHERE report_date = p_date;
  INSERT INTO public.rw_daily_report_history (report_date, action, status, remarks, note, actor_id)
  VALUES (p_date, 'reopened', 'draft',
          jsonb_build_object('summary', v_row.summary, 'biggest_loss_remark', v_row.biggest_loss_remark, 'action_plan', v_row.action_plan),
          v_note, v_user);

  PERFORM public.notify_role(
    ARRAY['rejections_manager']::app_role[], 'R&W daily report reopened',
    'The report for ' || to_char(p_date, 'DD Mon YYYY') || ' was reopened: ' || v_note || ' Please correct and resubmit.',
    'warning', 'rejections_wastages', '/rejections/daily-report?date=' || p_date::text,
    'rw_daily_report', public.rw_daily_report_ref(p_date), v_user, v_user);
END;
$$;

CREATE OR REPLACE FUNCTION public.rw_daily_report_settings_save(
  p_enabled boolean, p_start_date date, p_reminder_time time, p_submit_by_time time,
  p_approve_hours integer, p_resubmit_hours integer, p_alert_time time
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the report alert settings.';
  END IF;
  IF p_approve_hours IS NULL OR p_resubmit_hours IS NULL
     OR LEAST(p_approve_hours, p_resubmit_hours) < 1
     OR GREATEST(p_approve_hours, p_resubmit_hours) > 336 THEN
    RAISE EXCEPTION 'Hours must be between 1 and 336.';
  END IF;
  IF p_reminder_time IS NULL OR p_submit_by_time IS NULL OR p_reminder_time > p_submit_by_time THEN
    RAISE EXCEPTION 'The reminder time must not be after the submission deadline.';
  END IF;
  UPDATE public.rw_daily_report_settings
     SET enabled = COALESCE(p_enabled, true),
         start_date = COALESCE(p_start_date, start_date),
         reminder_time = p_reminder_time, submit_by_time = p_submit_by_time,
         approve_hours = p_approve_hours, resubmit_hours = p_resubmit_hours,
         alert_time = COALESCE(p_alert_time, '09:00'),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 7. Entries of a submitted / approved day are locked ---------------------------
-- Rework progress (status, completion, rework qty) does not change the loss and
-- stays editable. Anything else on a locked day is refused until a super admin
-- reopens the report.

CREATE OR REPLACE FUNCTION public.rw_block_locked_day()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dates date[];
  v_hit record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_dates := ARRAY[NEW.entry_date];
  ELSIF TG_OP = 'DELETE' THEN
    v_dates := ARRAY[OLD.entry_date];
  ELSE
    IF (to_jsonb(NEW) - 'rework_status' - 'rework_completed_at' - 'rework_qty' - 'updated_at')
       = (to_jsonb(OLD) - 'rework_status' - 'rework_completed_at' - 'rework_qty' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    v_dates := ARRAY[OLD.entry_date, NEW.entry_date];
  END IF;

  SELECT report_date, status INTO v_hit
    FROM public.rw_daily_reports
   WHERE report_date = ANY (v_dates) AND status IN ('submitted','approved')
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'The R&W daily report for % is %. Entries for that day are locked until a super admin reopens the report.',
      to_char(v_hit.report_date, 'DD Mon YYYY'), v_hit.status;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS rw_rejections_lock_day ON public.rw_rejections;
CREATE TRIGGER rw_rejections_lock_day BEFORE INSERT OR UPDATE OR DELETE ON public.rw_rejections
  FOR EACH ROW EXECUTE FUNCTION public.rw_block_locked_day();
DROP TRIGGER IF EXISTS rw_wastages_lock_day ON public.rw_wastages;
CREATE TRIGGER rw_wastages_lock_day BEFORE INSERT OR UPDATE OR DELETE ON public.rw_wastages
  FOR EACH ROW EXECUTE FUNCTION public.rw_block_locked_day();
DROP TRIGGER IF EXISTS rw_leakages_lock_day ON public.rw_leakages;
CREATE TRIGGER rw_leakages_lock_day BEFORE INSERT OR UPDATE OR DELETE ON public.rw_leakages
  FOR EACH ROW EXECUTE FUNCTION public.rw_block_locked_day();

-- 8. The recurring check ---------------------------------------------------------
-- Runs every 15 minutes. A date is alerted as soon as it becomes due, then once
-- per Pakistan day at the first run on or after alert_time.

CREATE OR REPLACE FUNCTION public.rw_daily_report_notify_due()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.rw_daily_report_settings%ROWTYPE;
  r record;
  v_now_pk timestamp := now() AT TIME ZONE 'Asia/Karachi';
  v_label text;
  v_link text;
  v_n integer := 0;
BEGIN
  SELECT * INTO s FROM public.rw_daily_report_settings WHERE id;
  IF NOT FOUND OR NOT s.enabled THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT d.report_date, d.due_kind, COALESCE(a.alert_count, 0) AS alert_count
      FROM public.rw_daily_report_days(GREATEST(s.start_date, v_now_pk::date - 60), v_now_pk::date - 1) d
      LEFT JOIN public.rw_daily_report_alerts a
        ON a.report_date = d.report_date AND a.kind = d.due_kind
     WHERE d.due_kind IS NOT NULL
       AND (a.report_date IS NULL
            OR ((a.last_alerted_at AT TIME ZONE 'Asia/Karachi')::date < v_now_pk::date AND v_now_pk::time >= s.alert_time))
     ORDER BY d.report_date
  LOOP
    v_label := to_char(r.report_date, 'DD Mon YYYY');
    v_link := '/rejections/daily-report?date=' || r.report_date::text;
    PERFORM public.rw_daily_report_clear_alerts(r.report_date);

    IF r.due_kind = 'reminder' THEN
      PERFORM public.notify_role(
        ARRAY['rejections_manager']::app_role[], 'R&W daily report due',
        'Please add your remarks and submit the Rejections & Wastages report for ' || v_label
          || ' by ' || to_char(s.submit_by_time, 'HH24:MI') || '.',
        'warning', 'rejections_wastages', v_link, 'rw_daily_report', public.rw_daily_report_ref(r.report_date), NULL, NULL);
    ELSIF r.due_kind = 'overdue' THEN
      PERFORM public.notify_role(
        ARRAY['super_admin','rejections_manager']::app_role[], 'R&W daily report overdue',
        'Day ' || (r.alert_count + 1) || ' · The Rejections & Wastages report for ' || v_label || ' has not been submitted.',
        'error', 'rejections_wastages', v_link, 'rw_daily_report', public.rw_daily_report_ref(r.report_date), NULL, NULL);
    ELSE
      PERFORM public.notify_role(
        ARRAY['super_admin']::app_role[], 'R&W daily report awaiting approval',
        'Day ' || (r.alert_count + 1) || ' · The report for ' || v_label
          || ' has waited more than ' || s.approve_hours || ' hours for approval.',
        'error', 'rejections_wastages', v_link, 'rw_daily_report', public.rw_daily_report_ref(r.report_date), NULL, NULL);
    END IF;

    INSERT INTO public.rw_daily_report_alerts (report_date, kind, alert_count, last_alerted_at)
    VALUES (r.report_date, r.due_kind, 1, now())
    ON CONFLICT (report_date, kind) DO UPDATE
      SET alert_count = public.rw_daily_report_alerts.alert_count + 1, last_alerted_at = now();
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'rw-daily-report-due';
    PERFORM cron.schedule('rw-daily-report-due', '*/15 * * * *', 'SELECT public.rw_daily_report_notify_due()');
  END IF;
END $$;

-- 9. Permissions ----------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.rw_daily_report_figures(date),
  public.rw_daily_report_days(date, date),
  public.rw_daily_report_save(date, text, text, text, boolean),
  public.rw_daily_report_review(date, boolean, text),
  public.rw_daily_report_reopen(date, text),
  public.rw_daily_report_settings_save(boolean, date, time, time, integer, integer, time)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.rw_daily_report_notify_due(),
  public.rw_daily_report_clear_alerts(date)
FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
