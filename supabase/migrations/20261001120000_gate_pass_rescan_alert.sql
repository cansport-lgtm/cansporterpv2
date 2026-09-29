-- ============================================================================
-- Gate Pass: alarm when an old pass is scanned again at the gate
-- ----------------------------------------------------------------------------
-- A pass that already went out (or was returned, closed, cancelled or
-- rejected) must never let a vehicle out again. When the guard opens one on
-- Gate Check, the page sounds an alarm and calls gate_pass_log_rescan, which:
--   • logs a 'rescan_attempt' event on the pass (who, when), every time;
--   • notifies the gate pass managers and the pass maker, at most once per
--     pass every 10 minutes so repeated scans don't flood them.
-- ============================================================================

CREATE INDEX IF NOT EXISTS gate_pass_events_rescan_idx
  ON public.gate_pass_events (created_at DESC) WHERE event = 'rescan_attempt';

CREATE OR REPLACE FUNCTION public.gate_pass_log_rescan(p_id uuid, p_vehicle text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_recent boolean;
  v_msg text;
  v_n integer;
BEGIN
  IF NOT public.gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can use Gate Check.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status NOT IN ('out','partially_returned','returned','closed','cancelled','rejected') THEN
    RETURN jsonb_build_object('logged', false);
  END IF;

  v_msg := 'Scanned again at the gate — pass is ' || replace(g.status, '_', ' ')
        || CASE WHEN g.gate_out_at IS NOT NULL
                THEN ', went out ' || to_char(g.gate_out_at AT TIME ZONE 'Asia/Karachi', 'DD Mon YYYY HH24:MI') ELSE '' END
        || COALESCE('. Vehicle seen: ' || NULLIF(btrim(p_vehicle), ''), '');

  SELECT EXISTS (SELECT 1 FROM public.gate_pass_events
                  WHERE gate_pass_id = p_id AND event = 'rescan_attempt'
                    AND created_at > now() - interval '10 minutes') INTO v_recent;

  PERFORM public.gate_pass_log(p_id, 'rescan_attempt', v_msg,
    jsonb_build_object('status', g.status, 'vehicle', NULLIF(btrim(p_vehicle), '')));
  SELECT count(*) INTO v_n FROM public.gate_pass_events WHERE gate_pass_id = p_id AND event = 'rescan_attempt';

  IF NOT v_recent THEN
    PERFORM public.gate_pass_notify(g, 'Old gate pass scanned again',
      g.pass_number || ' (' || g.party_name || ') was scanned again at the gate. ' || v_msg,
      'error', true, true);
  END IF;
  RETURN jsonb_build_object('logged', true, 'attempts', v_n, 'notified', NOT v_recent);
END;
$$;

GRANT EXECUTE ON FUNCTION public.gate_pass_log_rescan(uuid, text) TO anon, authenticated, service_role;
