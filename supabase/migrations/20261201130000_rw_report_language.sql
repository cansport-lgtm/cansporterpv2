-- ============================================================================
-- R&W daily report: language choice and Roman Urdu + English messages
--
-- app_users.ui_language ('en' | 'ur' | 'ro'; NULL = Roman Urdu) remembers each
-- user's choice on the report page. Messages the database writes (bell alerts and
-- the "day is locked" error) are not known to be read by whom, so they carry
-- Roman Urdu and English together, Roman Urdu first.
--
-- Rollback: supabase/rollbacks/20261201130000_rw_report_language_down.sql
-- ============================================================================

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS ui_language text;
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_ui_language_check;
ALTER TABLE public.app_users
  ADD CONSTRAINT app_users_ui_language_check CHECK (ui_language IS NULL OR ui_language IN ('en','ur','ro'));

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
    RAISE EXCEPTION '% ki R&W daily report % hai. Is din ki entries lock hain, Super Admin report dobara open karega tab change hongi. | The R&W daily report for % is %. Entries for that day are locked until a super admin reopens the report.',
      to_char(v_hit.report_date, 'DD Mon YYYY'),
      CASE v_hit.status WHEN 'approved' THEN 'approve ho chuki' ELSE 'submit ho chuki' END,
      to_char(v_hit.report_date, 'DD Mon YYYY'), v_hit.status;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

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
      ARRAY['super_admin']::app_role[], 'R&W report approval chahiye · R&W report awaiting approval',
      to_char(p_date, 'DD Mon YYYY') || ' ki R&W report submit ho gayi hai, approval chahiye. · The Rejections & Wastages report for '
        || to_char(p_date, 'DD Mon YYYY') || ' was submitted and needs your approval.',
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
      ARRAY['rejections_manager']::app_role[], 'R&W report reject hui · R&W report rejected',
      to_char(p_date, 'DD Mon YYYY') || ' ki report reject hui: ' || v_note || ' Theek karke dobara submit karein. · The report for '
        || to_char(p_date, 'DD Mon YYYY') || ' was rejected: ' || v_note || ' Please correct and resubmit.',
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
    ARRAY['rejections_manager']::app_role[], 'R&W report dobara open hui · R&W report reopened',
    to_char(p_date, 'DD Mon YYYY') || ' ki report dobara open hui: ' || v_note || ' Theek karke dobara submit karein. · The report for '
      || to_char(p_date, 'DD Mon YYYY') || ' was reopened: ' || v_note || ' Please correct and resubmit.',
    'warning', 'rejections_wastages', '/rejections/daily-report?date=' || p_date::text,
    'rw_daily_report', public.rw_daily_report_ref(p_date), v_user, v_user);
END;
$$;

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
        ARRAY['rejections_manager']::app_role[], 'R&W report submit karni hai · R&W report due',
        v_label || ' ki Rejection & Wastage report remarks ke sath ' || to_char(s.submit_by_time, 'HH24:MI')
          || ' tak submit karein. · Please add your remarks and submit the Rejections & Wastages report for ' || v_label
          || ' by ' || to_char(s.submit_by_time, 'HH24:MI') || '.',
        'warning', 'rejections_wastages', v_link, 'rw_daily_report', public.rw_daily_report_ref(r.report_date), NULL, NULL);
    ELSIF r.due_kind = 'overdue' THEN
      PERFORM public.notify_role(
        ARRAY['super_admin','rejections_manager']::app_role[], 'R&W report late hai · R&W report overdue',
        'Day ' || (r.alert_count + 1) || ' · ' || v_label || ' ki report abhi tak submit nahi hui. · The Rejections & Wastages report for '
          || v_label || ' has not been submitted.',
        'error', 'rejections_wastages', v_link, 'rw_daily_report', public.rw_daily_report_ref(r.report_date), NULL, NULL);
    ELSE
      PERFORM public.notify_role(
        ARRAY['super_admin']::app_role[], 'R&W report approval late hai · R&W report approval overdue',
        'Day ' || (r.alert_count + 1) || ' · ' || v_label || ' ki report ko ' || s.approve_hours
          || ' ghante se zyada ho gaye, approval chahiye. · The report for ' || v_label
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

NOTIFY pgrst, 'reload schema';
