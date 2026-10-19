-- ============================================================================
-- Labour Gate Pass: remove a wrong half day
-- ----------------------------------------------------------------------------
-- Before the time-outside thresholds (20261006120000), a short leave still out
-- at day end closed as "not returned" and the date was marked HALF DAY however
-- short the time outside. That migration copied those marks into
-- labour_gate_passes.attendance_effect, so the dates stayed locked at half day:
-- deleting the productivity rows does not help, the Daily Entry form and the
-- trigger force every new row for that worker and date back to half day.
--
-- 1. One-time repair: a short leave marked half day whose working time outside
--    (gate out → gate in, or day end, inside 08:30–19:30) is NOT over the
--    half-day threshold (180 min) loses the mark. Left alone: half-day passes,
--    official duty, absents, passes still out, and passes an approver
--    converted to half day by hand ("Did not return · mark half day").
--    Each cleared pass gets a 'half_day_removed' event with the minutes.
-- 2. labour_gate_pass_remove_half_day(p_id, p_reason): super admin removes the
--    half day from one pass, with a reason, from the pass page.
--
-- Productivity rows that are still half day for those dates are NOT changed
-- back (their earlier work type is not recorded); the count is in the event,
-- and a super admin can edit them to Full Day.
-- Builds on 20261006120000_labour_gate_pass_outside_thresholds.sql.
-- Rollback: supabase/rollbacks/20261102120000_labour_gate_pass_remove_half_day_down.sql
-- ============================================================================

-- 1. One-time repair -------------------------------------------------------------

DO $$
DECLARE
  s public.labour_gate_pass_settings%ROWTYPE;
  r record;
BEGIN
  SELECT * INTO s FROM public.labour_gate_pass_settings WHERE id;
  FOR r IN
    SELECT g.id, g.pass_number, g.employee_id, g.pass_date,
           public.labour_gate_pass_work_minutes(g.gate_out_at,
             LEAST(COALESCE(g.gate_in_at, public.labour_gate_pass_day_end_at(g.pass_date)),
                   public.labour_gate_pass_day_end_at(g.pass_date)),
             g.pass_date) AS minutes
      FROM public.labour_gate_passes g
     WHERE g.pass_kind = 'short_leave'
       AND g.attendance_effect = 'half_day'
       AND g.status <> 'out'
       AND g.gate_out_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.labour_gate_pass_events ev
          WHERE ev.pass_id = g.id AND ev.event = 'not_returned'
            AND ev.message ILIKE 'Converted to half day by the approver%')
     FOR UPDATE OF g
  LOOP
    CONTINUE WHEN r.minutes > s.half_day_after_minutes;
    UPDATE public.labour_gate_passes
       SET attendance_effect = NULL, attendance_marked_at = NULL, half_day_marked_at = NULL,
           half_day_rows = NULL, work_minutes_outside = r.minutes, updated_at = now()
     WHERE id = r.id;
    PERFORM public.labour_gate_pass_log(r.id, 'half_day_removed',
      'Half day removed (old rule fix): outside ' || r.minutes || ' min of working time, not over '
        || s.half_day_after_minutes || ' min',
      jsonb_build_object('source', 'repair_20261102', 'minutes', r.minutes,
        'half_day_rows_left', (SELECT count(*) FROM public.labour_productivity_targets t
                                WHERE t.employee_id = r.employee_id AND t.target_date = r.pass_date
                                  AND t.work_type = 'half_day')));
  END LOOP;
END;
$$;

-- 2. Remove a half day by hand (super admin) --------------------------------------

CREATE OR REPLACE FUNCTION public.labour_gate_pass_remove_half_day(p_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.labour_gate_passes%ROWTYPE;
  v_left integer;
BEGIN
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can remove a half day from a gate pass.';
  END IF;
  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Give a reason for removing the half day.';
  END IF;
  SELECT * INTO g FROM public.labour_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.attendance_effect IS DISTINCT FROM 'half_day' THEN
    RAISE EXCEPTION 'Gate pass % does not mark a half day.', g.pass_number;
  END IF;
  -- A short leave still out would be marked again by the next tick.
  IF g.pass_kind = 'short_leave' AND g.status = 'out' THEN
    RAISE EXCEPTION 'Gate pass % is still out — remove the half day after the worker is back or the day has closed.', g.pass_number;
  END IF;

  UPDATE public.labour_gate_passes
     SET attendance_effect = NULL, attendance_marked_at = NULL, half_day_marked_at = NULL,
         half_day_rows = NULL, updated_at = now()
   WHERE id = p_id;

  SELECT count(*) INTO v_left FROM public.labour_productivity_targets t
   WHERE t.employee_id = g.employee_id AND t.target_date = g.pass_date AND t.work_type = 'half_day';

  PERFORM public.labour_gate_pass_log(p_id, 'half_day_removed',
    'Half day removed: ' || btrim(p_reason)
      || CASE WHEN v_left > 0 THEN ' (' || v_left || ' productivity entr'
              || CASE WHEN v_left = 1 THEN 'y is' ELSE 'ies are' END || ' still half day — edit to Full Day if needed)'
              ELSE '' END,
    jsonb_build_object('reason', btrim(p_reason), 'half_day_rows_left', v_left));
  RETURN jsonb_build_object('half_day_rows_left', v_left);
END;
$$;

REVOKE ALL ON FUNCTION public.labour_gate_pass_remove_half_day(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.labour_gate_pass_remove_half_day(uuid, text) TO authenticated, service_role;
