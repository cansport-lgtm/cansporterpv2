-- Rollback for 20261107120000_staff_gate_pass_no_short_leave_convert.sql
-- Restores the approver's "convert an overdue short leave to a half day"
-- (body from 20261003120100_staff_gate_pass.sql). Also set
-- convertShortLeave: true on STAFF_PASS in src/lib/personGatePass.ts.

CREATE OR REPLACE FUNCTION public.staff_gate_pass_convert_half_day(p_id uuid, p_reason text DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  v_rows integer;
BEGIN
  IF NOT public.staff_gate_pass_can('approve') THEN
    RAISE EXCEPTION 'Only the staff gate pass approver can convert a pass to a half day.';
  END IF;
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF NOT (g.pass_kind = 'short_leave' AND g.status = 'out') THEN
    RAISE EXCEPTION 'Only a short leave that is still out can be converted to a half day.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason.';
  END IF;

  UPDATE public.staff_gate_passes
     SET status = 'not_returned', closed_at = now(), close_note = btrim(p_reason), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.staff_gate_pass_log(p_id, 'not_returned', 'Converted to half day by the approver: ' || btrim(p_reason));
  v_rows := public.staff_gate_pass_mark_half_day(p_id);
  PERFORM public.staff_gate_pass_notify(g, 'Short leave converted to half day',
    public.staff_gate_pass_label(g) || ' did not come back; ' || to_char(g.pass_date, 'DD Mon') || ' is marked Half day. ' || btrim(p_reason),
    'warning', true, false);
  RETURN v_rows;
END;
$$;
