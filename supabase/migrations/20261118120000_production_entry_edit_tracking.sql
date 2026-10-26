-- ============================================================
-- Production: daily entry edit tracking
--
-- Every edit of a daily production entry (production_entries + its rejection
-- breakdown) is now:
--   1. recorded in production_entry_edits (who, when, why, before/after,
--      per-field old → new),
--   2. flagged on the entry itself (edit_count, last_edited_*, edited_fields
--      = the ORIGINAL value of every field that still differs from what was
--      first saved) so every list, dashboard, report and export can show an
--      "Edited" badge and highlight the changed figures without a join,
--   3. notified to everyone in the entry's department (and the entry's
--      creator) as a warning, and to every super admin as a red alert that
--      stays on their dashboards until acknowledged,
--   4. subject to a mandatory reason and a 60-minute edit window for anyone
--      who is not a super admin (enforced here, not only in the page).
--
-- Edits go through production_entry_edit(...), which replaces the rejection
-- breakdown and updates the entry in one transaction. The BEFORE UPDATE
-- trigger does the bookkeeping, so a direct UPDATE of the figures from any
-- other path is logged and notified too (and still needs a reason).
--
-- Posting / unposting (status, approved_by, approved_at) is not an edit.
--
-- Rollback: supabase/rollbacks/20261118120000_production_entry_edit_tracking_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns on production_entries
-- ------------------------------------------------------------

ALTER TABLE public.production_entries
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_edited_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_edit_reason text,
  ADD COLUMN IF NOT EXISTS edited_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_production_entries_edited
  ON public.production_entries (last_edited_at DESC)
  WHERE edit_count > 0;

-- ------------------------------------------------------------
-- 2. Edit log
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.production_entry_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid REFERENCES public.production_entries(id) ON DELETE SET NULL,
  edit_no integer NOT NULL,
  -- Snapshot of the entry's identity so the log stays readable if the entry
  -- is later deleted.
  entry_date date NOT NULL,
  shift text,
  department_id uuid,
  department_name text,
  sub_department_name text,
  grade_id uuid,
  grade_code text,
  grade_name text,
  edited_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  edited_by_name text,
  edited_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  -- { field: { old, new } } for every field that changed in this edit
  -- (including "rejections" when the breakdown changed).
  changes jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_data jsonb NOT NULL,
  after_data jsonb NOT NULL,
  rejections_before jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejections_after jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_production_entry_edits_entry
  ON public.production_entry_edits (entry_id, edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_entry_edits_edited_at
  ON public.production_entry_edits (edited_at DESC);
CREATE INDEX IF NOT EXISTS idx_production_entry_edits_unacked
  ON public.production_entry_edits (edited_at DESC)
  WHERE acknowledged_at IS NULL;

ALTER TABLE public.production_entry_edits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_production_entry_edits ON public.production_entry_edits;
CREATE POLICY allow_read_production_entry_edits
  ON public.production_entry_edits FOR SELECT USING (true);
REVOKE ALL ON public.production_entry_edits FROM anon, authenticated;
GRANT SELECT ON public.production_entry_edits TO anon, authenticated, service_role;

-- Settings: the daily reminder to super admins about unacknowledged edits.
CREATE TABLE IF NOT EXISTS public.production_entry_edit_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  summary_enabled boolean NOT NULL DEFAULT true,
  summary_time time NOT NULL DEFAULT '09:00',
  last_summary_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.production_entry_edit_settings (id) VALUES (true) ON CONFLICT DO NOTHING;
ALTER TABLE public.production_entry_edit_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_production_entry_edit_settings ON public.production_entry_edit_settings;
CREATE POLICY allow_read_production_entry_edit_settings
  ON public.production_entry_edit_settings FOR SELECT USING (true);
REVOKE ALL ON public.production_entry_edit_settings FROM anon, authenticated;
GRANT SELECT ON public.production_entry_edit_settings TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Helpers
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.production_entry_is_super_admin(p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_user IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = 'super_admin'
  );
$$;

-- The rejection breakdown of an entry as a stable JSON array.
CREATE OR REPLACE FUNCTION public.production_entry_rejections_json(p_entry uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'defect_reason_id', r.defect_reason_id,
             'defect_reason', d.name,
             'quantity', r.quantity,
             'remarks', r.remarks)
           ORDER BY d.name, r.defect_reason_id)
      FROM public.production_rejections r
      LEFT JOIN public.defect_reasons d ON d.id = r.defect_reason_id
     WHERE r.production_entry_id = p_entry
  ), '[]'::jsonb);
$$;

-- Human label of a tracked field.
CREATE OR REPLACE FUNCTION public.production_entry_field_label(p_field text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_field
    WHEN 'entry_date' THEN 'Date'
    WHEN 'shift' THEN 'Shift'
    WHEN 'department_id' THEN 'Department'
    WHEN 'sub_department_id' THEN 'Sub-department'
    WHEN 'grade_id' THEN 'Grade'
    WHEN 'target_production' THEN 'Target'
    WHEN 'quantity_produced' THEN 'Produced'
    WHEN 'quantity_ok' THEN 'OK'
    WHEN 'quantity_rejected' THEN 'Rejected'
    WHEN 'remarks' THEN 'Remarks'
    WHEN 'machine_id' THEN 'Machine'
    WHEN 'operator_id' THEN 'Operator'
    WHEN 'supervisor_id' THEN 'Supervisor'
    WHEN 'rejections' THEN 'Rejection details'
    ELSE p_field END;
$$;

-- Display value of a tracked field (ids are resolved to names).
CREATE OR REPLACE FUNCTION public.production_entry_field_display(p_field text, p_value jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_text text := CASE WHEN p_value IS NULL OR p_value = 'null'::jsonb THEN NULL ELSE p_value #>> '{}' END;
  v_name text;
BEGIN
  IF v_text IS NULL THEN RETURN '—'; END IF;
  CASE p_field
    WHEN 'department_id' THEN
      SELECT name INTO v_name FROM public.production_departments WHERE id = v_text::uuid;
    WHEN 'sub_department_id' THEN
      SELECT name INTO v_name FROM public.production_sub_departments WHERE id = v_text::uuid;
    WHEN 'grade_id' THEN
      SELECT code INTO v_name FROM public.grades WHERE id = v_text::uuid;
    WHEN 'machine_id' THEN
      SELECT name INTO v_name FROM public.machines WHERE id = v_text::uuid;
    WHEN 'operator_id', 'supervisor_id' THEN
      SELECT full_name INTO v_name FROM public.app_users WHERE id = v_text::uuid;
    WHEN 'target_production', 'quantity_produced', 'quantity_ok', 'quantity_rejected' THEN
      v_name := to_char(v_text::numeric, 'FM999,999,999,990.##');
    ELSE
      v_name := NULL;
  END CASE;
  RETURN COALESCE(v_name, v_text);
EXCEPTION WHEN OTHERS THEN
  RETURN v_text;
END;
$$;

-- ------------------------------------------------------------
-- 4. Trigger: record the edit, flag the entry, notify
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.track_production_entry_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_fields CONSTANT text[] := ARRAY[
    'entry_date','shift','department_id','sub_department_id','grade_id',
    'target_production','quantity_produced','quantity_ok','quantity_rejected',
    'remarks','machine_id','operator_id','supervisor_id'];
  v_old jsonb := to_jsonb(OLD);
  v_new jsonb := to_jsonb(NEW);
  v_field text;
  v_changes jsonb := '{}'::jsonb;
  v_edited jsonb := COALESCE(OLD.edited_fields, '{}'::jsonb);
  v_rej_before jsonb;
  v_rej_after jsonb;
  v_actor uuid;
  v_actor_name text;
  v_reason text;
  v_is_super boolean;
  v_dept_name text;
  v_sub_name text;
  v_grade_code text;
  v_grade_name text;
  v_parts text[] := ARRAY[]::text[];
  v_summary text;
  v_head text;
  v_msg text;
  v_edit_id uuid;
  v_link text;
  v_recipient uuid;
  v_key text;
BEGIN
  -- Only the tracked fields count; posting / unposting is not an edit.
  FOREACH v_field IN ARRAY c_fields LOOP
    IF v_old -> v_field IS DISTINCT FROM v_new -> v_field THEN
      v_changes := v_changes || jsonb_build_object(v_field,
        jsonb_build_object('old', v_old -> v_field, 'new', v_new -> v_field));
    END IF;
  END LOOP;

  -- Rejection breakdown: production_entry_edit() stores the "before" picture
  -- in a transaction setting before replacing the rows. A direct UPDATE has
  -- no such picture, so the breakdown is treated as unchanged.
  v_rej_after := public.production_entry_rejections_json(NEW.id);
  BEGIN
    v_rej_before := NULLIF(current_setting('app.pe_rejections_before', true), '')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_rej_before := NULL;
  END;
  v_rej_before := COALESCE(v_rej_before, v_rej_after);
  IF v_rej_before IS DISTINCT FROM v_rej_after THEN
    v_changes := v_changes || jsonb_build_object('rejections',
      jsonb_build_object('old', v_rej_before, 'new', v_rej_after));
  END IF;

  IF v_changes = '{}'::jsonb THEN
    -- Nothing that matters changed: keep the edit stamps as they were.
    NEW.edit_count := OLD.edit_count;
    NEW.last_edited_at := OLD.last_edited_at;
    NEW.last_edited_by := OLD.last_edited_by;
    NEW.last_edit_reason := OLD.last_edit_reason;
    NEW.edited_fields := OLD.edited_fields;
    RETURN NEW;
  END IF;

  -- Who and why.
  v_actor := public.app_user_id();
  IF v_actor IS NULL THEN
    BEGIN
      v_actor := NULLIF(current_setting('app.pe_actor', true), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_actor := NULL;
    END;
  END IF;
  v_reason := NULLIF(btrim(COALESCE(NEW.last_edit_reason, '')), '');
  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'A reason (at least 5 characters) is required to edit a production entry.';
  END IF;
  v_is_super := public.production_entry_is_super_admin(v_actor);
  SELECT full_name INTO v_actor_name FROM public.app_users WHERE id = v_actor;
  v_actor_name := COALESCE(v_actor_name, 'Unknown user');

  -- Flag the entry. edited_fields keeps the ORIGINAL value of every field
  -- that still differs from the first save, so screens can highlight it and
  -- show "was X".
  FOR v_key IN SELECT jsonb_object_keys(v_changes) LOOP
    IF v_key <> 'rejections' AND NOT (v_edited ? v_key) THEN
      v_edited := v_edited || jsonb_build_object(v_key, v_old -> v_key);
    END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(v_edited) LOOP
    IF v_edited -> v_key IS NOT DISTINCT FROM v_new -> v_key THEN
      v_edited := v_edited - v_key;
    END IF;
  END LOOP;
  IF v_changes ? 'rejections' THEN
    v_edited := v_edited || jsonb_build_object('rejections', true);
  END IF;

  NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
  NEW.last_edited_at := now();
  NEW.last_edited_by := v_actor;
  NEW.last_edit_reason := v_reason;
  NEW.edited_fields := v_edited;

  -- Names for the log and the message.
  SELECT name INTO v_dept_name FROM public.production_departments WHERE id = NEW.department_id;
  SELECT name INTO v_sub_name FROM public.production_sub_departments WHERE id = NEW.sub_department_id;
  SELECT code, name INTO v_grade_code, v_grade_name FROM public.grades WHERE id = NEW.grade_id;

  FOREACH v_field IN ARRAY c_fields LOOP
    IF v_changes ? v_field THEN
      v_parts := array_append(v_parts, public.production_entry_field_label(v_field) || ' '
        || public.production_entry_field_display(v_field, v_changes #> ARRAY[v_field, 'old'])
        || ' → '
        || public.production_entry_field_display(v_field, v_changes #> ARRAY[v_field, 'new']));
    END IF;
  END LOOP;
  IF v_changes ? 'rejections' THEN
    v_parts := array_append(v_parts, 'Rejection details changed');
  END IF;
  v_summary := array_to_string(v_parts, '; ');

  INSERT INTO public.production_entry_edits (
    entry_id, edit_no, entry_date, shift, department_id, department_name,
    sub_department_name, grade_id, grade_code, grade_name,
    edited_by, edited_by_name, edited_at, reason, changes,
    before_data, after_data, rejections_before, rejections_after, summary)
  VALUES (
    NEW.id, NEW.edit_count, NEW.entry_date, NEW.shift, NEW.department_id, v_dept_name,
    v_sub_name, NEW.grade_id, v_grade_code, v_grade_name,
    v_actor, v_actor_name, NEW.last_edited_at, v_reason, v_changes,
    v_old - 'edited_fields' - 'last_edit_reason' - 'last_edited_at' - 'last_edited_by' - 'edit_count',
    v_new - 'edited_fields' - 'last_edit_reason' - 'last_edited_at' - 'last_edited_by' - 'edit_count',
    v_rej_before, v_rej_after, v_summary)
  RETURNING id INTO v_edit_id;

  -- Notifications.
  v_link := '/production/entry-edits?edit=' || v_edit_id;
  v_head := COALESCE(v_dept_name, 'Production') || ' · ' || to_char(NEW.entry_date, 'DD Mon YYYY')
         || ' · ' || COALESCE(NEW.shift, '') || ' · Grade ' || COALESCE(v_grade_code, '?');
  v_msg := v_head || E'\n' || v_summary
        || E'\nEdited by ' || v_actor_name
        || CASE WHEN v_is_super THEN ' (super admin)' ELSE '' END
        || ' (edit #' || NEW.edit_count || ').'
        || E'\nReason: ' || v_reason;

  -- Everyone in the entry's department (old and new department if it moved)
  -- plus whoever created the entry; the editor is not told about their own edit.
  FOR v_recipient IN
    SELECT DISTINCT u.id
      FROM public.app_users u
     WHERE u.is_active = true
       AND (u.department_id = NEW.department_id
            OR u.department_id = OLD.department_id
            OR u.id = NEW.created_by)
       AND (v_actor IS NULL OR u.id <> v_actor)
  LOOP
    PERFORM public.notify_user(
      v_recipient,
      'Production entry edited',
      v_msg, 'warning', 'production', v_link,
      'production_entry_edit', v_edit_id, v_actor);
  END LOOP;

  -- Every super admin, including the editor when they are one: red alert.
  PERFORM public.notify_role(
    ARRAY['super_admin']::app_role[],
    'PRODUCTION ENTRY EDITED',
    v_msg, 'error', 'production', v_link,
    'production_entry_edit', v_edit_id, v_actor, NULL);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_entry_track_edit ON public.production_entries;
-- Named so it runs after trg_production_entry_posting_lock (alphabetical
-- order of BEFORE triggers): a locked entry is rejected before being logged.
CREATE TRIGGER trg_production_entry_track_edit
  BEFORE UPDATE ON public.production_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.track_production_entry_edit();

-- ------------------------------------------------------------
-- 5. The edit itself: window + reason + rejections + update in one call
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.production_entry_edit(
  p_entry_id uuid,
  p_entry jsonb,
  p_rejections jsonb,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_user_id();
  v_row public.production_entries%ROWTYPE;
  v_is_super boolean;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_rej jsonb;
  v_edit_id uuid;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;
  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Please give a reason for the edit (at least 5 characters).';
  END IF;

  SELECT * INTO v_row FROM public.production_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production entry not found.';
  END IF;
  IF v_row.status = 'Posted' THEN
    RAISE EXCEPTION 'This entry is posted and locked. Unpost it before editing.';
  END IF;

  v_is_super := public.production_entry_is_super_admin(v_actor);
  IF NOT v_is_super AND v_row.created_at < now() - interval '60 minutes' THEN
    RAISE EXCEPTION 'Editing window expired (60 minutes). Contact a Super Admin.';
  END IF;

  PERFORM set_config('app.pe_actor', v_actor::text, true);
  PERFORM set_config('app.pe_rejections_before',
                     public.production_entry_rejections_json(p_entry_id)::text, true);

  DELETE FROM public.production_rejections WHERE production_entry_id = p_entry_id;
  IF p_rejections IS NOT NULL AND jsonb_typeof(p_rejections) = 'array' THEN
    FOR v_rej IN SELECT * FROM jsonb_array_elements(p_rejections) LOOP
      IF NULLIF(v_rej ->> 'defect_reason_id', '') IS NOT NULL
         AND COALESCE((v_rej ->> 'quantity')::numeric, 0) > 0 THEN
        INSERT INTO public.production_rejections (production_entry_id, defect_reason_id, quantity, remarks)
        VALUES (p_entry_id, (v_rej ->> 'defect_reason_id')::uuid,
                (v_rej ->> 'quantity')::numeric, NULLIF(v_rej ->> 'remarks', ''));
      END IF;
    END LOOP;
  END IF;

  UPDATE public.production_entries SET
    entry_date        = COALESCE((p_entry ->> 'entry_date')::date, entry_date),
    shift             = COALESCE(p_entry ->> 'shift', shift),
    department_id     = COALESCE((p_entry ->> 'department_id')::uuid, department_id),
    sub_department_id = CASE WHEN p_entry ? 'sub_department_id'
                             THEN NULLIF(p_entry ->> 'sub_department_id', '')::uuid
                             ELSE sub_department_id END,
    grade_id          = COALESCE((p_entry ->> 'grade_id')::uuid, grade_id),
    uom_id            = COALESCE((p_entry ->> 'uom_id')::uuid, uom_id),
    target_production = COALESCE((p_entry ->> 'target_production')::numeric, target_production),
    quantity_produced = COALESCE((p_entry ->> 'quantity_produced')::numeric, quantity_produced),
    quantity_ok       = COALESCE((p_entry ->> 'quantity_ok')::numeric, quantity_ok),
    quantity_rejected = COALESCE((p_entry ->> 'quantity_rejected')::numeric, quantity_rejected),
    remarks           = CASE WHEN p_entry ? 'remarks' THEN NULLIF(p_entry ->> 'remarks', '') ELSE remarks END,
    last_edit_reason  = v_reason,
    updated_at        = now()
  WHERE id = p_entry_id;

  SELECT id INTO v_edit_id FROM public.production_entry_edits
   WHERE entry_id = p_entry_id ORDER BY edited_at DESC, edit_no DESC LIMIT 1;

  RETURN jsonb_build_object('status', 'ok', 'edit_id', v_edit_id);
END;
$$;

REVOKE ALL ON FUNCTION public.production_entry_edit(uuid, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_entry_edit(uuid, jsonb, jsonb, text)
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Super admin acknowledgement
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.production_entry_edits_acknowledge(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_user_id();
  v_n integer;
BEGIN
  IF NOT public.production_entry_is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Only a super admin can acknowledge production entry edits.';
  END IF;
  UPDATE public.production_entry_edits
     SET acknowledged_at = now(), acknowledged_by = v_actor
   WHERE id = ANY (p_ids) AND acknowledged_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

-- Acknowledge every open edit at once (the banner's "Acknowledge all").
CREATE OR REPLACE FUNCTION public.production_entry_edits_acknowledge_all()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_user_id();
  v_n integer;
BEGIN
  IF NOT public.production_entry_is_super_admin(v_actor) THEN
    RAISE EXCEPTION 'Only a super admin can acknowledge production entry edits.';
  END IF;
  UPDATE public.production_entry_edits
     SET acknowledged_at = now(), acknowledged_by = v_actor
   WHERE acknowledged_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.production_entry_edits_acknowledge(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.production_entry_edits_acknowledge_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_entry_edits_acknowledge(uuid[])
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.production_entry_edits_acknowledge_all()
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 7. Daily reminder while edits stay unacknowledged
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.production_entry_edit_settings_save(
  p_enabled boolean, p_time time
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.production_entry_is_super_admin(public.app_user_id()) THEN
    RAISE EXCEPTION 'Only a super admin can change these settings.';
  END IF;
  UPDATE public.production_entry_edit_settings
     SET summary_enabled = COALESCE(p_enabled, summary_enabled),
         summary_time = COALESCE(p_time, summary_time),
         updated_at = now()
   WHERE id = true;
END;
$$;
REVOKE ALL ON FUNCTION public.production_entry_edit_settings_save(boolean, time) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_entry_edit_settings_save(boolean, time)
  TO anon, authenticated, service_role;

-- Runs every 15 minutes (pg_cron). Once a day, at the set Pakistan time, it
-- reminds every super admin of edits nobody has acknowledged yet.
CREATE OR REPLACE FUNCTION public.production_entry_edits_daily_summary()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.production_entry_edit_settings%ROWTYPE;
  v_now_pk timestamp := (now() AT TIME ZONE 'Asia/Karachi');
  v_today date := v_now_pk::date;
  v_open integer;
  v_oldest timestamptz;
  v_depts text;
BEGIN
  SELECT * INTO v_s FROM public.production_entry_edit_settings WHERE id = true;
  IF NOT FOUND OR NOT v_s.summary_enabled THEN RETURN 0; END IF;
  IF v_s.last_summary_date IS NOT DISTINCT FROM v_today THEN RETURN 0; END IF;
  IF v_now_pk::time < v_s.summary_time THEN RETURN 0; END IF;

  SELECT count(*), min(edited_at),
         string_agg(DISTINCT COALESCE(department_name, '?'), ', ')
    INTO v_open, v_oldest, v_depts
    FROM public.production_entry_edits
   WHERE acknowledged_at IS NULL;

  UPDATE public.production_entry_edit_settings
     SET last_summary_date = v_today, updated_at = now() WHERE id = true;

  IF COALESCE(v_open, 0) = 0 THEN RETURN 0; END IF;

  PERFORM public.notify_role(
    ARRAY['super_admin']::app_role[],
    'Unacknowledged production entry edits',
    v_open || ' production entry edit' || CASE WHEN v_open = 1 THEN '' ELSE 's' END
      || ' still need' || CASE WHEN v_open = 1 THEN 's' ELSE '' END
      || ' your acknowledgement (' || v_depts || '; oldest '
      || to_char(v_oldest AT TIME ZONE 'Asia/Karachi', 'DD Mon HH24:MI') || ').',
    'error', 'production', '/production/entry-edits?open=1',
    'production_entry_edit_summary', NULL, NULL, NULL);
  RETURN v_open;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'production-entry-edits-summary';
    PERFORM cron.schedule('production-entry-edits-summary', '*/15 * * * *',
                          'SELECT public.production_entry_edits_daily_summary()');
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.production_entry_edits_daily_summary() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. Realtime: open screens refresh themselves when an entry is edited
-- ------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'production_entries') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_entries;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                  WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
                    AND tablename = 'production_entry_edits') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.production_entry_edits;
  END IF;
END $$;
