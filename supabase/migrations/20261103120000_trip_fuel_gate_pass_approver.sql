-- ============================================================================
-- Staff trip fuel: the staff gate pass approver approves fuel claims too
-- ----------------------------------------------------------------------------
--  * staff_trip_fuel_can('approve') now also allows staff_gate_pass_approver,
--    next to the HR manager (and super admin). Both can approve or reject.
--  * New action 'hr' (super_admin, hr_manager): cancelling a claim that is not
--    your own and cancelling an APPROVED voucher stay with HR, as before (cash
--    may already have been handed over).
--  * The approver's capacity is recorded: staff_trip_fuel_vouchers.approved_as
--    holds the role they acted in (hr_manager, staff_gate_pass_approver or
--    super_admin) next to approved_by / approved_at, and the event log's
--    details carry it too. Older vouchers keep approved_as NULL (read as HR).
--  * No self-approval: nobody but a super admin can approve or reject a claim
--    they raised or a claim for themselves.
--  * Staff gate pass approvers get the "needs approval" and cancel notices.
--
-- Rollback: supabase/rollbacks/20261103120000_trip_fuel_gate_pass_approver_down.sql
-- ============================================================================

-- 1. Approver capacity ------------------------------------------------------------

ALTER TABLE public.staff_trip_fuel_vouchers ADD COLUMN IF NOT EXISTS approved_as text;
COMMENT ON COLUMN public.staff_trip_fuel_vouchers.approved_as IS
  'Role the approver / rejecter acted in: hr_manager, staff_gate_pass_approver or super_admin. NULL on vouchers reviewed before 2026-11 (HR).';

-- 2. Permissions -------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'approve'  THEN ARRAY['super_admin','hr_manager','staff_gate_pass_approver']
    WHEN 'hr'       THEN ARRAY['super_admin','hr_manager']
    WHEN 'pay'      THEN ARRAY['super_admin','pettycash_handler','expenses_manager','expenses_officer']
    WHEN 'settings' THEN ARRAY['super_admin']
    ELSE ARRAY[]::text[] END);
$$;

-- The role the current user approves in; HR manager first when they hold several.
CREATE OR REPLACE FUNCTION public.staff_trip_fuel_approver_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN public.gate_pass_has_any_role(ARRAY['hr_manager']) THEN 'hr_manager'
    WHEN public.gate_pass_has_any_role(ARRAY['staff_gate_pass_approver']) THEN 'staff_gate_pass_approver'
    WHEN public.gate_pass_has_any_role(ARRAY['super_admin']) THEN 'super_admin'
  END;
$$;

-- 3. Notices: approvers hear about new and cancelled claims --------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_notify(
  p_v public.staff_trip_fuel_vouchers, p_title text, p_message text, p_type text DEFAULT 'info',
  p_to_maker boolean DEFAULT true, p_to_hr boolean DEFAULT false, p_to_cashier boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_hr_link text := '/hr/gate-pass/' || p_v.pass_id::text;
  v_maker_link text;
BEGIN
  IF p_to_hr THEN
    PERFORM public.notify_role(ARRAY['super_admin','hr_manager','staff_gate_pass_approver']::app_role[], p_title, p_message, p_type,
      'hr', v_hr_link, 'staff_trip_fuel', p_v.id, v_uid, v_uid);
  END IF;
  IF p_to_cashier THEN
    PERFORM public.notify_role(ARRAY['pettycash_handler','expenses_manager']::app_role[], p_title, p_message, p_type,
      'expenses', '/expenses/trip-fuel', 'staff_trip_fuel', p_v.id, v_uid, v_uid);
  END IF;
  IF p_to_maker AND p_v.created_by IS NOT NULL AND p_v.created_by IS DISTINCT FROM v_uid THEN
    v_maker_link := CASE WHEN EXISTS (SELECT 1 FROM public.employees e
                                       WHERE e.id = p_v.employee_id AND e.app_user_id = p_v.created_by)
                         THEN '/my-gate-pass/' || p_v.pass_id::text ELSE v_hr_link END;
    PERFORM public.notify_user(p_v.created_by, p_title, p_message, p_type,
      'hr', v_maker_link, 'staff_trip_fuel', p_v.id, v_uid);
  END IF;
END;
$$;

-- 4. Review: approver or HR manager, never on your own claim, capacity recorded ------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_review(p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.staff_trip_fuel_vouchers%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
  v_uid uuid := public.app_user_id();
  v_role text := public.staff_trip_fuel_approver_role();
BEGIN
  IF NOT public.staff_trip_fuel_can('approve') THEN
    RAISE EXCEPTION 'Only an HR manager or a staff gate pass approver can approve or reject a trip fuel claim.';
  END IF;
  SELECT * INTO v FROM public.staff_trip_fuel_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel voucher not found.';
  END IF;
  -- Maker-checker: not on a claim you raised or a claim for yourself (super admin excepted).
  IF NOT public.gate_pass_has_any_role(ARRAY['super_admin'])
     AND (v.created_by IS NOT DISTINCT FROM v_uid
          OR EXISTS (SELECT 1 FROM public.employees e WHERE e.id = v.employee_id AND e.app_user_id = v_uid)) THEN
    RAISE EXCEPTION 'Fuel voucher % is your own claim, so another approver must approve or reject it.', v.voucher_number;
  END IF;
  IF v.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Fuel voucher % is not waiting for approval.', v.voucher_number;
  END IF;
  IF NOT p_approve AND NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the claim.';
  END IF;

  UPDATE public.staff_trip_fuel_vouchers
     SET status = v_status, approved_by = v_uid, approved_at = now(), approved_as = v_role,
         approval_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v;
  PERFORM public.staff_trip_fuel_log(p_id, v_status, NULLIF(btrim(p_remarks), ''), jsonb_build_object('role', v_role));
  IF p_approve THEN
    PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel voucher approved',
      public.staff_trip_fuel_label(v) || ' is approved for Rs ' || trim(to_char(v.amount, 'FM999999990'))
        || '. The cashier pays it in cash against the printed voucher.' || COALESCE(' ' || NULLIF(btrim(p_remarks), ''), ''),
      'success', true, false, true);
  ELSE
    PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel claim rejected',
      public.staff_trip_fuel_label(v) || ': ' || btrim(p_remarks), 'warning', true, false, false);
  END IF;
  RETURN v_status;
END;
$$;

-- 5. Cancel: unchanged rules, still HR-only (not the gate pass approver) --------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_cancel(p_id uuid, p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.staff_trip_fuel_vouchers%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  SELECT * INTO v FROM public.staff_trip_fuel_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel voucher not found.';
  END IF;
  IF v.status NOT IN ('pending_approval','approved') THEN
    RAISE EXCEPTION 'Fuel voucher % is % and cannot be cancelled.', v.voucher_number, replace(v.status, '_', ' ');
  END IF;
  IF v.status = 'approved' THEN
    IF NOT public.staff_trip_fuel_can('hr') THEN
      RAISE EXCEPTION 'Fuel voucher % is approved. Only an HR manager can cancel it.', v.voucher_number;
    END IF;
  ELSIF NOT (public.staff_trip_fuel_can('hr') OR v.created_by = v_uid) THEN
    RAISE EXCEPTION 'Only the person who claimed or an HR manager can cancel this voucher.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the voucher.';
  END IF;

  UPDATE public.staff_trip_fuel_vouchers
     SET status = 'cancelled', cancelled_by = v_uid, cancelled_at = now(), cancel_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v;
  PERFORM public.staff_trip_fuel_log(p_id, 'cancelled', btrim(p_reason));
  PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel voucher cancelled',
    public.staff_trip_fuel_label(v) || ': ' || btrim(p_reason), 'warning', true, true, v.approved_at IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.staff_trip_fuel_can(text),
  public.staff_trip_fuel_review(uuid, boolean, text),
  public.staff_trip_fuel_cancel(uuid, text)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.staff_trip_fuel_approver_role(),
  public.staff_trip_fuel_notify(public.staff_trip_fuel_vouchers, text, text, text, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.staff_trip_fuel_approver_role(),
  public.staff_trip_fuel_notify(public.staff_trip_fuel_vouchers, text, text, text, boolean, boolean, boolean)
  TO service_role;
