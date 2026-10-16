-- ============================================================================
-- Gate Inward: a returnable that comes back whole is received at the gate
-- ----------------------------------------------------------------------------
-- Phase 1 recorded the arrival only and left the quantities to the office
-- ("Receive goods" on the pass). For a RETURNABLE pass that comes back in
-- full (a machine from repair, a mould from a loan) that extra step is just
-- delay, so the guard now answers "did everything come back?" on the gate
-- entry and, on yes, gate_inward_receive_all receives every open line of
-- the pass through the existing gate_pass_receive: the GPR- receipt, the
-- stock move back from GP-REPAIR, spare-part stock and the pass status are
-- all unchanged — the guard simply triggers them.
--
-- Job-work passes are NOT received at the gate: the office must say what
-- was used up, what came back processed and what was rejected.
--
-- gate_pass_receive requires the gate_pass 'create' role, which the guard
-- does not hold. gate_pass_can therefore also accepts a transaction-local
-- flag (gate_inward.auto_receive = on) that only gate_inward_receive_all
-- sets, after its own role and entry checks, for the one call.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.gate_pass_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT (p_action = 'create' AND COALESCE(current_setting('gate_inward.auto_receive', true), '') = 'on')
      OR public.gate_pass_has_any_role(CASE p_action
    WHEN 'create'  THEN ARRAY['super_admin','gate_pass_manager','gate_pass_officer']
    WHEN 'approve' THEN ARRAY['super_admin','gate_pass_manager']
    WHEN 'gate'    THEN ARRAY['super_admin','gate_pass_manager','gate_security']
    ELSE ARRAY[]::text[] END);
$$;

-- Everything on the returnable pass is back: receive all open lines now.
-- Returns the GPR- receipt number.
CREATE OR REPLACE FUNCTION public.gate_inward_receive_all(p_entry_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e public.gate_inward_entries%ROWTYPE;
  g public.gate_passes%ROWTYPE;
  v_lines jsonb;
  v_rid uuid;
  v_num text;
BEGIN
  IF NOT (public.gate_inward_can('gate') OR public.gate_inward_can('office')) THEN
    RAISE EXCEPTION 'Only gate security or the purchase office can receive goods at the gate.';
  END IF;
  SELECT * INTO e FROM public.gate_inward_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate inward entry not found.';
  END IF;
  IF e.status <> 'at_gate' THEN
    RAISE EXCEPTION 'Entry % is already %.', e.entry_number, replace(e.status, '_', ' ');
  END IF;
  IF e.entry_kind <> 'returnable_return' THEN
    RAISE EXCEPTION 'Only a returnable pass is received at the gate. Job-work goods are received by the office (used, processed, rejected).';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = e.gate_pass_id;
  IF NOT FOUND OR g.pass_type <> 'returnable' THEN
    RAISE EXCEPTION 'Entry % is not for a returnable pass.', e.entry_number;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('gate_pass_item_id', i.id, 'settled_quantity', public.gate_pass_line_balance(i.id)))
    INTO v_lines
    FROM public.gate_pass_items i
   WHERE i.gate_pass_id = g.id AND public.gate_pass_line_balance(i.id) > 0;
  IF v_lines IS NULL THEN
    RAISE EXCEPTION 'Nothing is outside on % any more.', g.pass_number;
  END IF;

  PERFORM set_config('gate_inward.auto_receive', 'on', true);
  v_rid := public.gate_pass_receive(g.id, (now() AT TIME ZONE 'Asia/Karachi')::date, v_lines,
             'Everything back — received at the gate on ' || e.entry_number);
  PERFORM set_config('gate_inward.auto_receive', '', true);

  UPDATE public.gate_pass_receipts SET gate_inward_id = p_entry_id WHERE id = v_rid
  RETURNING receipt_number INTO v_num;
  UPDATE public.gate_inward_entries
     SET status = 'received', gate_pass_receipt_id = v_rid, closed_at = now(), closed_by = public.app_user_id()
   WHERE id = p_entry_id
  RETURNING * INTO e;
  PERFORM public.gate_inward_log(p_entry_id, 'received', 'Everything back — received at the gate on ' || v_num);
  PERFORM public.gate_inward_notify(e, 'Returnable goods back',
    g.pass_number || ' (' || g.party_name || ') came back in full and was received at the gate on ' || v_num || ' · ' || e.entry_number,
    'success', true, false);
  RETURN v_num;
END;
$$;

GRANT EXECUTE ON FUNCTION public.gate_inward_receive_all(uuid) TO anon, authenticated, service_role;
