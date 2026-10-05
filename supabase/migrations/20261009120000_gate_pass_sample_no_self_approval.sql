-- ============================================================================
-- Gate Pass: the maker of a Sample pass cannot approve or reject it
-- ----------------------------------------------------------------------------
-- A sample manager who raises a sample pass must have another sample manager
-- (or super admin) approve it. Super admin is exempt and may approve anything,
-- including their own passes. Other pass types are unchanged.
-- ============================================================================

-- Types where the pass maker may not review their own pass.
CREATE OR REPLACE FUNCTION public.gate_pass_self_review_blocked(p_type text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p_type = 'sample'; $$;

CREATE OR REPLACE FUNCTION public.gate_pass_review(p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF NOT public.gate_pass_can_approve_type(g.pass_type) THEN
    RAISE EXCEPTION 'Only the % gate pass manager can approve or reject this pass.',
      lower(replace(g.pass_type, '_', ' '));
  END IF;
  -- Maker-checker: whoever raised a sample pass cannot review it (super admin excepted).
  IF public.gate_pass_self_review_blocked(g.pass_type)
     AND g.created_by IS NOT DISTINCT FROM public.app_user_id()
     AND NOT public.gate_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'You raised this % pass, so another % manager must approve or reject it.',
      lower(replace(g.pass_type, '_', ' ')), lower(replace(g.pass_type, '_', ' '));
  END IF;
  IF g.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Gate pass % is not waiting for approval.', g.pass_number;
  END IF;
  IF NOT p_approve AND NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the pass.';
  END IF;

  UPDATE public.gate_passes
     SET status = v_status, approved_by = public.app_user_id(), approved_at = now(),
         approval_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, v_status, NULLIF(btrim(p_remarks), ''));
  PERFORM public.gate_pass_notify(g,
    'Gate pass ' || v_status,
    g.pass_number || ' for ' || g.party_name || COALESCE(': ' || NULLIF(btrim(p_remarks), ''), ''),
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END, true, false);
  RETURN v_status;
END;
$$;

-- Submit: the "needs approval" notice skips the maker on types they cannot
-- review themselves, so a sample manager is not asked to approve their own pass.
CREATE OR REPLACE FUNCTION public.gate_pass_submit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_ids uuid[];
  v_bad text;
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to submit gate passes.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.status <> 'draft' THEN
    RAISE EXCEPTION 'Gate pass % is already %.', g.pass_number, replace(g.status, '_', ' ');
  END IF;

  -- Re-check the source documents and stock: they may have changed since the draft.
  IF g.pass_type = 'sales' THEN
    SELECT array_agg(dispatch_id) INTO v_ids FROM public.gate_pass_dispatches WHERE gate_pass_id = p_id;
    PERFORM public.gate_pass_build_sales(p_id, v_ids);
  ELSIF g.pass_type = 'supplier_return' THEN
    PERFORM public.gate_pass_build_supplier_return(p_id, g.purchase_return_id);
  ELSIF NOT EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id) THEN
    RAISE EXCEPTION 'Add at least one line.';
  ELSIF g.pass_type = 'scrap' THEN
    SELECT string_agg(i.description, ', ') INTO v_bad
      FROM public.gate_pass_items i
     WHERE i.gate_pass_id = p_id AND i.quantity > public.gate_pass_scrap_balance(i.scrap_category_id);
    IF v_bad IS NOT NULL THEN
      RAISE EXCEPTION 'The Scrap Yard no longer holds enough of: %.', v_bad;
    END IF;
  END IF;

  IF g.pass_type IN ('sales','supplier_return') THEN
    UPDATE public.gate_passes
       SET status = 'approved', submitted_at = now(), approved_at = now(), approved_by = NULL,
           approval_remarks = CASE g.pass_type
             WHEN 'sales' THEN 'Approved automatically: the sales orders are approved.'
             ELSE 'Approved automatically: goes back on a purchase return.' END,
           updated_at = now()
     WHERE id = p_id;
    PERFORM public.gate_pass_log(p_id, 'approved', 'Approved automatically');
    RETURN 'approved';
  END IF;

  UPDATE public.gate_passes
     SET status = 'pending_approval', submitted_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_log(p_id, 'submitted', 'Sent for approval');
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  PERFORM public.notify_role(
    public.gate_pass_approver_roles(g.pass_type)::app_role[], 'Gate pass needs approval',
    g.pass_number || ' · ' || initcap(replace(g.pass_type, '_', ' ')) || ' for ' || g.party_name,
    'info', 'gate_pass', '/gate-pass/passes/' || g.id::text, 'gate_pass', g.id,
    public.app_user_id(),
    CASE WHEN public.gate_pass_self_review_blocked(g.pass_type) THEN g.created_by ELSE public.app_user_id() END);
  RETURN 'pending_approval';
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.gate_pass_self_review_blocked(text),
  public.gate_pass_review(uuid, boolean, text),
  public.gate_pass_submit(uuid)
TO anon, authenticated, service_role;
