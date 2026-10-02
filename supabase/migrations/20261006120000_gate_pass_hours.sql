-- ============================================================================
-- Gate Pass: gate hours and emergency (after-hours) approval
-- ----------------------------------------------------------------------------
-- Pakistan time, every day; Sunday is a holiday (no passes made, nothing leaves):
--   Sales                    → made until 4:00 pm, leaves the gate until 4:30 pm
--   Every other goods type   → made until 5:00 pm, leaves the gate until 5:30 pm
-- After a cut-off, a gate pass officer can still make / submit a pass with an
-- emergency reason, or ask for emergency approval on an approved or held pass
-- that missed the gate. Only a super admin decides, and sets "valid until".
-- At the gate, a pass after the gate cut-off without a valid emergency approval
-- is held and the managers are told. Releasing a held pass after hours needs
-- the emergency approval too. Manual backfill is not affected.
-- Times and the closed weekday are in gate_pass_settings (super admin).
-- ============================================================================

ALTER TABLE public.gate_pass_settings
  ADD COLUMN IF NOT EXISTS sales_create_until time NOT NULL DEFAULT '16:00',
  ADD COLUMN IF NOT EXISTS sales_gate_until time NOT NULL DEFAULT '16:30',
  ADD COLUMN IF NOT EXISTS other_create_until time NOT NULL DEFAULT '17:00',
  ADD COLUMN IF NOT EXISTS other_gate_until time NOT NULL DEFAULT '17:30',
  ADD COLUMN IF NOT EXISTS closed_weekdays smallint[] NOT NULL DEFAULT '{0}';

ALTER TABLE public.gate_passes
  ADD COLUMN IF NOT EXISTS emergency_status text CHECK (emergency_status IN ('requested','approved','rejected')),
  ADD COLUMN IF NOT EXISTS emergency_reason text,
  ADD COLUMN IF NOT EXISTS emergency_requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS emergency_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_decided_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS emergency_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS emergency_remarks text;
CREATE INDEX IF NOT EXISTS gate_passes_emergency_idx ON public.gate_passes (emergency_status) WHERE emergency_status IS NOT NULL;

-- Why passes of this type are closed now (NULL = open). p_stage: 'create' or 'gate'.
CREATE OR REPLACE FUNCTION public.gate_pass_closed_reason(p_type text, p_stage text, p_at timestamptz DEFAULT now())
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  s public.gate_pass_settings%ROWTYPE;
  v_local timestamp := p_at AT TIME ZONE 'Asia/Karachi';
  v_until time;
  v_label text := initcap(replace(p_type, '_', ' '));
BEGIN
  SELECT * INTO s FROM public.gate_pass_settings WHERE id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF extract(dow FROM v_local)::smallint = ANY (s.closed_weekdays) THEN
    RETURN to_char(v_local, 'FMDay') || ' is a holiday: no gate passes are made and nothing leaves the gate.';
  END IF;
  v_until := CASE WHEN p_type = 'sales'
                  THEN CASE p_stage WHEN 'create' THEN s.sales_create_until ELSE s.sales_gate_until END
                  ELSE CASE p_stage WHEN 'create' THEN s.other_create_until ELSE s.other_gate_until END END;
  IF v_local::time < v_until THEN
    RETURN NULL;
  END IF;
  RETURN CASE WHEN p_stage = 'create' THEN v_label || ' gate passes can only be made until '
              WHEN p_type = 'sales' THEN 'Sales dispatch cannot leave the gate after '
              ELSE v_label || ' passes cannot leave the gate after ' END
         || to_char(date '2000-01-01' + v_until, 'FMHH12:MI am') || '.';
END;
$$;

-- Gate hours for the screens, decided on the server clock.
CREATE OR REPLACE FUNCTION public.gate_pass_hours()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'now', to_char(now() AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD"T"HH24:MI:SS'),
    'sales_create', public.gate_pass_closed_reason('sales', 'create'),
    'sales_gate', public.gate_pass_closed_reason('sales', 'gate'),
    'other_create', public.gate_pass_closed_reason('sample', 'create'),
    'other_gate', public.gate_pass_closed_reason('sample', 'gate'),
    'sales_create_until', to_char(s.sales_create_until, 'HH24:MI'),
    'sales_gate_until', to_char(s.sales_gate_until, 'HH24:MI'),
    'other_create_until', to_char(s.other_create_until, 'HH24:MI'),
    'other_gate_until', to_char(s.other_gate_until, 'HH24:MI'),
    'closed_weekdays', to_jsonb(s.closed_weekdays))
  FROM public.gate_pass_settings s WHERE s.id;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_emergency_valid(g public.gate_passes)
RETURNS boolean LANGUAGE sql STABLE
AS $$ SELECT g.emergency_status = 'approved' AND g.emergency_valid_until IS NOT NULL AND now() <= g.emergency_valid_until; $$;

CREATE OR REPLACE FUNCTION public.gate_pass_notify_super_admins(g public.gate_passes)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  PERFORM public.notify_role(ARRAY['super_admin']::app_role[], 'After-hours gate pass needs emergency approval',
    g.pass_number || ' · ' || initcap(replace(g.pass_type, '_', ' ')) || ' for ' || g.party_name
      || COALESCE(': ' || g.emergency_reason, ''),
    'warning', 'gate_pass', '/gate-pass/passes/' || g.id::text, 'gate_pass', g.id,
    public.app_user_id(), public.app_user_id());
END;
$$;

-- At the gate: hold a pass that is past the gate cut-off without a valid emergency
-- approval. Returns the gate result, or NULL when the pass may be checked normally.
CREATE OR REPLACE FUNCTION public.gate_pass_after_hours_hold(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_reason text;
  v_was text;
BEGIN
  IF NOT public.gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can use Gate Check.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.status NOT IN ('approved','held') THEN
    RETURN NULL;
  END IF;
  v_reason := public.gate_pass_closed_reason(g.pass_type, 'gate');
  IF v_reason IS NULL OR public.gate_pass_emergency_valid(g) THEN
    RETURN NULL;
  END IF;
  v_was := g.status;
  UPDATE public.gate_passes
     SET status = 'held', held_by = public.app_user_id(), held_at = now(),
         hold_note = 'After hours: ' || v_reason, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'held', g.hold_note, jsonb_build_object('after_hours', true));
  IF v_was = 'approved' OR g.emergency_status = 'approved' THEN
    PERFORM public.gate_pass_notify(g, 'Vehicle held at gate — after hours',
      g.pass_number || ' for ' || g.party_name || ': ' || v_reason
        || ' A super admin can give emergency approval.', 'warning', true, true);
  END IF;
  RETURN jsonb_build_object('status', 'held', 'after_hours', true, 'problems', jsonb_build_array(v_reason));
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_save(p_id uuid, p_data jsonb, p_submit boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_type text := p_data->>'pass_type';
  v_old public.gate_passes%ROWTYPE;
  v_id uuid := p_id;
  v_party_name text;
  v_party_id uuid;
  v_party_kind text;
  v_ids uuid[];
  v_vehicle text := NULLIF(btrim(p_data->>'vehicle_number'), '');
  v_remarks text := NULLIF(btrim(p_data->>'remarks'), '');
  v_bf jsonb := CASE WHEN jsonb_typeof(p_data->'backfill') = 'object' THEN p_data->'backfill' END;
  v_book public.gate_pass_books%ROWTYPE;
  v_serial integer;
  v_paper timestamptz;
  v_max integer;
  v_due date := NULLIF(p_data->>'expected_return_date', '')::date;
  v_date date := COALESCE(NULLIF(p_data->>'pass_date', '')::date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_emerg text := NULLIF(btrim(p_data->>'emergency_reason'), '');
  v_closed text;
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to make gate passes.';
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('sales','sample','supplier_return','returnable','job_work','scrap') THEN
    RAISE EXCEPTION 'Choose what is leaving.';
  END IF;

  -- Gate hours: after the cut-off (or on a holiday) a new pass, or a submit, needs
  -- an emergency reason and goes to a super admin.
  IF v_bf IS NULL AND (p_id IS NULL OR p_submit) THEN
    v_closed := public.gate_pass_closed_reason(v_type, 'create');
    IF v_closed IS NOT NULL AND v_emerg IS NULL THEN
      RAISE EXCEPTION '% Ask a super admin for emergency approval, with a reason.', v_closed;
    END IF;
    IF v_closed IS NOT NULL AND NOT p_submit THEN
      RAISE EXCEPTION 'An after-hours pass is sent straight to a super admin for emergency approval.';
    END IF;
  END IF;

  IF v_bf IS NOT NULL THEN
    IF NOT public.gate_pass_can('approve') THEN
      RAISE EXCEPTION 'Only a gate pass manager can enter a manual backfill.';
    END IF;
    IF p_id IS NOT NULL THEN
      RAISE EXCEPTION 'A backfill is entered in one go, not from a draft.';
    END IF;
    SELECT * INTO v_book FROM public.gate_pass_books WHERE id = NULLIF(v_bf->>'book_id', '')::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Select the paper book.';
    END IF;
    IF NOT v_book.is_active THEN
      RAISE EXCEPTION 'Paper book % is closed.', v_book.book_number;
    END IF;
    v_serial := NULLIF(v_bf->>'book_serial', '')::integer;
    IF v_serial IS NULL OR v_serial NOT BETWEEN v_book.serial_from AND v_book.serial_to THEN
      RAISE EXCEPTION 'Serial must be between % and % for book %.', v_book.serial_from, v_book.serial_to, v_book.book_number;
    END IF;
    IF EXISTS (SELECT 1 FROM public.gate_pass_book_spoiled WHERE book_id = v_book.id AND serial = v_serial) THEN
      RAISE EXCEPTION 'Serial % of book % is marked spoiled.', v_serial, v_book.book_number;
    END IF;
    IF EXISTS (SELECT 1 FROM public.gate_passes WHERE book_id = v_book.id AND book_serial = v_serial AND status <> 'cancelled') THEN
      RAISE EXCEPTION 'Serial % of book % is already entered.', v_serial, v_book.book_number;
    END IF;
    v_paper := NULLIF(v_bf->>'paper_datetime', '')::timestamptz;
    SELECT backfill_max_days INTO v_max FROM public.gate_pass_settings WHERE id;
    IF v_paper IS NULL THEN
      RAISE EXCEPTION 'Enter the date and time written on the paper pass.';
    END IF;
    IF v_paper > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'The paper date cannot be in the future.';
    END IF;
    IF v_paper < now() - make_interval(days => COALESCE(v_max, 7)) THEN
      RAISE EXCEPTION 'A paper pass older than % days cannot be backfilled.', COALESCE(v_max, 7);
    END IF;
    IF NULLIF(btrim(v_bf->>'photo_path'), '') IS NULL THEN
      RAISE EXCEPTION 'Add a photo of the paper pass.';
    END IF;
    IF NULLIF(btrim(v_bf->>'reason'), '') IS NULL THEN
      RAISE EXCEPTION 'Say why a paper pass was used.';
    END IF;
    v_date := (v_paper AT TIME ZONE 'Asia/Karachi')::date;
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM public.gate_passes WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Gate pass not found.';
    END IF;
    IF v_old.status <> 'draft' THEN
      RAISE EXCEPTION 'Gate pass % is % and can no longer be edited.', v_old.pass_number, replace(v_old.status, '_', ' ');
    END IF;
    IF v_old.pass_type <> v_type THEN
      RAISE EXCEPTION 'The type of a saved pass cannot be changed. Cancel it and make a new one.';
    END IF;
    IF v_old.created_by IS DISTINCT FROM v_uid AND NOT public.gate_pass_can('approve') THEN
      RAISE EXCEPTION 'Only the person who made this draft or a manager can edit it.';
    END IF;
  ELSE
    -- A placeholder number until every check has passed, so a failed save
    -- never uses up a GP number and the series stays without gaps.
    INSERT INTO public.gate_passes (pass_number, pass_type, party_name, created_by)
    VALUES ('NEW-' || gen_random_uuid()::text, v_type, '—', v_uid)
    RETURNING id INTO v_id;
  END IF;

  IF v_type = 'sales' THEN
    IF v_vehicle IS NULL THEN
      RAISE EXCEPTION 'Enter the vehicle number.';
    END IF;
    SELECT array_agg(DISTINCT x::uuid) INTO v_ids
      FROM jsonb_array_elements_text(COALESCE(p_data->'dispatch_ids', '[]'::jsonb)) x;
    SELECT b.party_name, b.party_id INTO v_party_name, v_party_id
      FROM public.gate_pass_build_sales(v_id, v_ids) b;
    v_party_kind := 'customer';
  ELSIF v_type = 'supplier_return' THEN
    SELECT b.party_name, b.party_id INTO v_party_name, v_party_id
      FROM public.gate_pass_build_supplier_return(v_id, NULLIF(p_data->>'purchase_return_id', '')::uuid) b;
    v_party_kind := 'supplier';
  ELSE
    v_party_kind := COALESCE(NULLIF(p_data->>'party_kind', ''), 'other');
    v_party_id := NULLIF(p_data->>'party_id', '')::uuid;
    IF v_type = 'sample' AND v_party_kind NOT IN ('customer','distributor','other')
       OR v_type IN ('returnable','job_work') AND v_party_kind NOT IN ('supplier','other')
       OR v_type = 'scrap' AND v_party_kind NOT IN ('customer','supplier','other') THEN
      RAISE EXCEPTION 'Choose who the goods are going to.';
    END IF;
    IF v_party_kind = 'other' THEN
      v_party_id := NULL;
      v_party_name := NULLIF(btrim(p_data->>'party_name'), '');
    ELSIF v_party_id IS NOT NULL THEN
      SELECT name INTO v_party_name
        FROM (SELECT id, name FROM public.customers WHERE v_party_kind = 'customer'
              UNION ALL SELECT id, name FROM public.distributors WHERE v_party_kind = 'distributor'
              UNION ALL SELECT id, name FROM public.suppliers WHERE v_party_kind = 'supplier') p
       WHERE p.id = v_party_id;
    END IF;
    IF v_party_name IS NULL THEN
      RAISE EXCEPTION 'Choose who the goods are going to.';
    END IF;

    IF v_type = 'sample' THEN
      IF v_remarks IS NULL THEN
        RAISE EXCEPTION 'Give the reason for these samples.';
      END IF;
      PERFORM public.gate_pass_build_sample(v_id, p_data->'lines');
    ELSIF v_type IN ('returnable','job_work') THEN
      IF v_due IS NULL THEN
        RAISE EXCEPTION 'Enter the date the goods are due back.';
      END IF;
      IF v_due < v_date THEN
        RAISE EXCEPTION 'The return date cannot be before the pass date.';
      END IF;
      IF v_type = 'job_work' AND NULLIF(btrim(p_data->>'process_name'), '') IS NULL THEN
        RAISE EXCEPTION 'Say what process the vendor is doing (e.g. printing).';
      END IF;
      PERFORM public.gate_pass_build_goods(v_id, v_type, p_data->'lines');
    ELSE
      PERFORM public.gate_pass_build_scrap(v_id, p_data->'lines');
    END IF;
  END IF;

  UPDATE public.gate_passes
     SET pass_date = v_date,
         party_kind = v_party_kind,
         party_id = v_party_id,
         party_name = v_party_name,
         vehicle_number = v_vehicle,
         driver_name = NULLIF(btrim(p_data->>'driver_name'), ''),
         driver_contact = NULLIF(btrim(p_data->>'driver_contact'), ''),
         transporter_name = NULLIF(btrim(p_data->>'transporter_name'), ''),
         purchase_return_id = CASE WHEN v_type = 'supplier_return'
                                   THEN NULLIF(p_data->>'purchase_return_id', '')::uuid END,
         expected_return_date = CASE WHEN v_type IN ('returnable','job_work') THEN v_due END,
         process_name = CASE WHEN v_type = 'job_work' THEN NULLIF(btrim(p_data->>'process_name'), '') END,
         remarks = v_remarks,
         pass_number = CASE WHEN p_id IS NULL
                            THEN 'GP-' || lpad(nextval('public.gate_pass_number_seq')::text, 6, '0')
                            ELSE pass_number END,
         updated_at = now()
   WHERE id = v_id;

  PERFORM public.gate_pass_log(v_id, CASE WHEN p_id IS NULL THEN 'created' ELSE 'edited' END);

  IF v_closed IS NOT NULL THEN
    UPDATE public.gate_passes
       SET emergency_status = 'requested', emergency_reason = v_emerg,
           emergency_requested_by = v_uid, emergency_requested_at = now(),
           emergency_decided_by = NULL, emergency_decided_at = NULL,
           emergency_valid_until = NULL, emergency_remarks = NULL
     WHERE id = v_id;
  END IF;

  IF v_bf IS NOT NULL THEN
    -- The goods already left on the paper pass: straight to Out, dated on paper.
    UPDATE public.gate_passes
       SET is_backfill = true, book_id = v_book.id, book_serial = v_serial,
           paper_datetime = v_paper, paper_photo_path = btrim(v_bf->>'photo_path'),
           backfill_reason = btrim(v_bf->>'reason'),
           status = 'approved', submitted_at = now(), approved_by = v_uid, approved_at = now(),
           approval_remarks = 'Manual backfill of paper pass ' || v_book.book_number || ' / ' || v_serial,
           updated_at = now()
     WHERE id = v_id;
    PERFORM public.gate_pass_log(v_id, 'backfilled',
      'Paper pass ' || v_book.book_number || ' / ' || v_serial || ': ' || btrim(v_bf->>'reason'));
    PERFORM public.gate_pass_mark_out(v_id, v_paper);
  ELSIF p_submit THEN
    PERFORM public.gate_pass_submit(v_id);
  END IF;
  RETURN v_id;
END;
$$;


CREATE OR REPLACE FUNCTION public.gate_pass_submit(p_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_ids uuid[];
  v_bad text;
  v_closed text;
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
  v_closed := public.gate_pass_closed_reason(g.pass_type, 'create');
  IF v_closed IS NOT NULL AND g.emergency_status IS DISTINCT FROM 'requested' THEN
    RAISE EXCEPTION '% Ask a super admin for emergency approval, with a reason.', v_closed;
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

  -- After hours: a super admin decides, whatever the type.
  IF g.emergency_status = 'requested' THEN
    UPDATE public.gate_passes
       SET status = 'pending_approval', submitted_at = now(), updated_at = now()
     WHERE id = p_id
    RETURNING * INTO g;
    PERFORM public.gate_pass_log(p_id, 'emergency_requested', g.emergency_reason);
    PERFORM public.gate_pass_notify_super_admins(g);
    RETURN 'pending_approval';
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
    public.app_user_id(), public.app_user_id());
  RETURN 'pending_approval';
END;
$$;


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
  IF g.emergency_status = 'requested' THEN
    RAISE EXCEPTION 'Gate pass % is an after-hours request: only a super admin can decide it, as an emergency approval.', g.pass_number;
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


CREATE OR REPLACE FUNCTION public.gate_pass_scrap_weigh(
  p_id uuid, p_readings jsonb, p_vehicle text, p_photo_path text, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  r jsonb;
  v_seq integer := 0;
  v_prev numeric;
  v_read numeric;
  v_cat uuid;
  v_problems text[] := ARRAY[]::text[];
  v_pct numeric;
  v_total numeric;
  v_est numeric;
  v_bad text;
  v_hold jsonb;
BEGIN
  IF NOT public.gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can weigh at the gate.';
  END IF;
  v_hold := public.gate_pass_after_hours_hold(p_id);
  IF v_hold IS NOT NULL THEN
    RETURN v_hold;
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND OR g.pass_type <> 'scrap' THEN
    RAISE EXCEPTION 'This is not a scrap pass.';
  END IF;
  IF g.status = 'out' THEN
    RAISE EXCEPTION 'Gate pass % has already gone out.', g.pass_number;
  END IF;
  IF g.status NOT IN ('approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % — it cannot leave yet.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF NULLIF(btrim(p_photo_path), '') IS NULL THEN
    RAISE EXCEPTION 'Take a photo of the weighbridge slip.';
  END IF;
  IF jsonb_typeof(p_readings) <> 'array' OR jsonb_array_length(p_readings) < 2 THEN
    RAISE EXCEPTION 'Weigh the empty truck and then after each scrap category.';
  END IF;

  DELETE FROM public.gate_pass_weighments WHERE gate_pass_id = p_id;
  FOR r IN SELECT * FROM jsonb_array_elements(p_readings) LOOP
    v_read := NULLIF(r->>'reading', '')::numeric;
    v_cat := NULLIF(r->>'scrap_category_id', '')::uuid;
    IF v_read IS NULL OR v_read < 0 THEN
      RAISE EXCEPTION 'Enter every scale reading.';
    END IF;
    IF v_seq = 0 AND v_cat IS NOT NULL THEN
      RAISE EXCEPTION 'The first weighing is the empty truck.';
    END IF;
    IF v_seq > 0 THEN
      IF v_cat IS NULL OR NOT EXISTS (SELECT 1 FROM public.gate_pass_items WHERE gate_pass_id = p_id AND scrap_category_id = v_cat) THEN
        RAISE EXCEPTION 'Each weighing after the empty truck must be for a scrap category on the pass.';
      END IF;
      IF EXISTS (SELECT 1 FROM public.gate_pass_weighments WHERE gate_pass_id = p_id AND scrap_category_id = v_cat) THEN
        RAISE EXCEPTION 'A scrap category was weighed twice.';
      END IF;
      IF v_read <= v_prev THEN
        RAISE EXCEPTION 'Each reading must be higher than the one before it.';
      END IF;
    END IF;
    v_seq := v_seq + 1;
    INSERT INTO public.gate_pass_weighments (gate_pass_id, seq, scrap_category_id, reading, net, slip_number, created_by)
    VALUES (p_id, v_seq, v_cat, v_read, CASE WHEN v_seq > 1 THEN v_read - v_prev END,
            NULLIF(btrim(r->>'slip'), ''), v_uid);
    v_prev := v_read;
  END LOOP;
  IF EXISTS (SELECT 1 FROM public.gate_pass_items i WHERE i.gate_pass_id = p_id AND NOT EXISTS
               (SELECT 1 FROM public.gate_pass_weighments w WHERE w.gate_pass_id = p_id AND w.scrap_category_id = i.scrap_category_id)) THEN
    RAISE EXCEPTION 'Weigh every scrap category on the pass.';
  END IF;

  -- The weighed net becomes the line quantity (the estimate stays in estimated_quantity).
  UPDATE public.gate_pass_items i
     SET quantity = w.net, counted = w.net, counted_by = v_uid, counted_at = now()
    FROM public.gate_pass_weighments w
   WHERE i.gate_pass_id = p_id AND w.gate_pass_id = p_id AND w.scrap_category_id = i.scrap_category_id;

  IF public.gate_pass_norm_vehicle(g.vehicle_number) IS NOT NULL
     AND public.gate_pass_norm_vehicle(g.vehicle_number) IS DISTINCT FROM public.gate_pass_norm_vehicle(p_vehicle) THEN
    v_problems := v_problems || ('Vehicle ' || COALESCE(NULLIF(btrim(p_vehicle), ''), '(none)') || ' is not ' || g.vehicle_number);
  END IF;
  SELECT string_agg(i.description || ' ' || i.quantity || ' ' || i.uom || ' (yard has '
                    || public.gate_pass_scrap_balance(i.scrap_category_id) || ')', '; ')
    INTO v_bad
    FROM public.gate_pass_items i
   WHERE i.gate_pass_id = p_id AND i.quantity > public.gate_pass_scrap_balance(i.scrap_category_id);
  IF v_bad IS NOT NULL THEN
    v_problems := v_problems || ('More than the Scrap Yard holds: ' || v_bad);
  END IF;
  SELECT scrap_overweight_pct INTO v_pct FROM public.gate_pass_settings WHERE id;
  SELECT SUM(quantity), SUM(estimated_quantity) INTO v_total, v_est FROM public.gate_pass_items WHERE gate_pass_id = p_id;
  IF v_total > v_est * (1 + COALESCE(v_pct, 10) / 100) THEN
    v_problems := v_problems || ('Weighed ' || v_total || ' kg against an approved ' || v_est
                                 || ' kg (over ' || COALESCE(v_pct, 10) || '%)');
  END IF;

  UPDATE public.gate_passes
     SET gate_vehicle_number = NULLIF(btrim(p_vehicle), ''), weighbridge_photo_path = btrim(p_photo_path)
   WHERE id = p_id;

  IF cardinality(v_problems) = 0 THEN
    PERFORM public.gate_pass_mark_out(p_id);
    RETURN jsonb_build_object('status', 'out', 'problems', '[]'::jsonb);
  END IF;

  UPDATE public.gate_passes
     SET status = 'held', held_by = v_uid, held_at = now(),
         hold_note = array_to_string(v_problems, '; ') || COALESCE(' — ' || NULLIF(btrim(p_note), ''), ''),
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;
  PERFORM public.gate_pass_log(p_id, 'held', g.hold_note, jsonb_build_object('problems', to_jsonb(v_problems)));
  PERFORM public.gate_pass_notify(g, 'Scrap vehicle held at gate', g.pass_number || ' for ' || g.party_name || ': ' || g.hold_note,
    'warning', true, true);
  RETURN jsonb_build_object('status', 'held', 'problems', to_jsonb(v_problems));
END;
$$;


CREATE OR REPLACE FUNCTION public.gate_pass_gate_check(
  p_id uuid, p_counts jsonb, p_vehicle text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_hold jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_id AND pass_type = 'scrap') THEN
    RAISE EXCEPTION 'A scrap pass is weighed at the gate, not counted.';
  END IF;
  v_hold := public.gate_pass_after_hours_hold(p_id);
  IF v_hold IS NOT NULL THEN
    RETURN v_hold;
  END IF;
  RETURN public.gate_pass_gate_check_count(p_id, p_counts, p_vehicle, p_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_release(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_closed text;
BEGIN
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  IF FOUND AND g.pass_type = 'scrap' THEN
    RAISE EXCEPTION 'A held scrap pass cannot be released. Unload to the approved weight and weigh again, or cancel the pass.';
  END IF;
  IF FOUND THEN
    v_closed := public.gate_pass_closed_reason(g.pass_type, 'gate');
    IF v_closed IS NOT NULL AND NOT public.gate_pass_emergency_valid(g) THEN
      RAISE EXCEPTION 'After hours: % A held pass needs super admin emergency approval before it can be released.', v_closed;
    END IF;
  END IF;
  PERFORM public.gate_pass_release_counted(p_id, p_reason);
END;
$$;

-- Officer: ask for emergency approval. A draft is submitted with the reason; an
-- approved or held pass keeps its status and waits for the super admin.
CREATE OR REPLACE FUNCTION public.gate_pass_request_emergency(p_id uuid, p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to ask for emergency approval.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give the reason for the emergency.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.emergency_status = 'requested' THEN
    RAISE EXCEPTION 'Gate pass % is already waiting for emergency approval.', g.pass_number;
  END IF;
  IF g.status NOT IN ('draft','approved','held') THEN
    RAISE EXCEPTION 'Gate pass % is % — emergency approval does not apply.', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  IF g.status = 'draft' AND public.gate_pass_closed_reason(g.pass_type, 'create') IS NULL THEN
    RAISE EXCEPTION 'Gate passes can still be made now — submit the pass normally.';
  END IF;
  IF g.status <> 'draft' AND public.gate_pass_closed_reason(g.pass_type, 'gate') IS NULL THEN
    RAISE EXCEPTION 'The gate is still open for this pass — no emergency approval is needed.';
  END IF;

  UPDATE public.gate_passes
     SET emergency_status = 'requested', emergency_reason = btrim(p_reason),
         emergency_requested_by = public.app_user_id(), emergency_requested_at = now(),
         emergency_decided_by = NULL, emergency_decided_at = NULL,
         emergency_valid_until = NULL, emergency_remarks = NULL, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;

  IF g.status = 'draft' THEN
    RETURN public.gate_pass_submit(p_id);
  END IF;
  PERFORM public.gate_pass_log(p_id, 'emergency_requested', btrim(p_reason));
  PERFORM public.gate_pass_notify_super_admins(g);
  RETURN g.status;
END;
$$;

-- Super admin: approve (until a time they choose) or reject an emergency request.
CREATE OR REPLACE FUNCTION public.gate_pass_emergency_review(
  p_id uuid, p_approve boolean, p_valid_until timestamptz DEFAULT NULL, p_remarks text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_uid uuid := public.app_user_id();
  v_msg text;
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can give emergency approval.';
  END IF;
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.emergency_status IS DISTINCT FROM 'requested' THEN
    RAISE EXCEPTION 'Gate pass % is not waiting for emergency approval.', g.pass_number;
  END IF;
  IF p_approve THEN
    IF p_valid_until IS NULL OR p_valid_until <= now() THEN
      RAISE EXCEPTION 'Choose until when the pass may leave (a time later than now).';
    END IF;
    IF p_valid_until > now() + interval '24 hours' THEN
      RAISE EXCEPTION 'Emergency approval can be given for at most 24 hours.';
    END IF;
  ELSIF NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the emergency request.';
  END IF;

  UPDATE public.gate_passes
     SET emergency_status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
         emergency_decided_by = v_uid, emergency_decided_at = now(),
         emergency_valid_until = CASE WHEN p_approve THEN p_valid_until END,
         emergency_remarks = NULLIF(btrim(p_remarks), ''),
         status = CASE WHEN g.status = 'pending_approval'
                       THEN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END
                       ELSE status END,
         approved_by = CASE WHEN g.status = 'pending_approval' THEN v_uid ELSE approved_by END,
         approved_at = CASE WHEN g.status = 'pending_approval' THEN now() ELSE approved_at END,
         approval_remarks = CASE WHEN g.status = 'pending_approval'
                                 THEN 'Emergency (after hours): ' || COALESCE(NULLIF(btrim(p_remarks), ''), g.emergency_reason)
                                 ELSE approval_remarks END,
         updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;

  v_msg := CASE WHEN p_approve
                THEN 'may leave until ' || to_char(p_valid_until AT TIME ZONE 'Asia/Karachi', 'DD Mon HH12:MI am')
                ELSE 'rejected' END
           || COALESCE(': ' || NULLIF(btrim(p_remarks), ''), '');
  PERFORM public.gate_pass_log(p_id, CASE WHEN p_approve THEN 'emergency_approved' ELSE 'emergency_rejected' END, v_msg);
  PERFORM public.gate_pass_notify(g,
    CASE WHEN p_approve THEN 'Emergency gate pass approved' ELSE 'Emergency gate pass rejected' END,
    g.pass_number || ' for ' || g.party_name || ' ' || v_msg,
    CASE WHEN p_approve THEN 'success' ELSE 'warning' END, true, true);
  RETURN g.emergency_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_hours_save(
  p_sales_create time, p_sales_gate time, p_other_create time, p_other_gate time, p_closed_weekdays smallint[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change gate hours.';
  END IF;
  IF p_sales_create IS NULL OR p_sales_gate IS NULL OR p_other_create IS NULL OR p_other_gate IS NULL THEN
    RAISE EXCEPTION 'Enter all four times.';
  END IF;
  IF p_sales_gate < p_sales_create OR p_other_gate < p_other_create THEN
    RAISE EXCEPTION 'The gate time cannot be earlier than the last time to make a pass.';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(COALESCE(p_closed_weekdays, '{}')) d WHERE d NOT BETWEEN 0 AND 6) THEN
    RAISE EXCEPTION 'Closed days are weekday numbers 0 (Sunday) to 6 (Saturday).';
  END IF;
  UPDATE public.gate_pass_settings
     SET sales_create_until = p_sales_create, sales_gate_until = p_sales_gate,
         other_create_until = p_other_create, other_gate_until = p_other_gate,
         closed_weekdays = COALESCE(p_closed_weekdays, '{}'),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.gate_pass_closed_reason(text, text, timestamptz),
  public.gate_pass_hours(),
  public.gate_pass_after_hours_hold(uuid),
  public.gate_pass_save(uuid, jsonb, boolean),
  public.gate_pass_submit(uuid),
  public.gate_pass_review(uuid, boolean, text),
  public.gate_pass_gate_check(uuid, jsonb, text, text),
  public.gate_pass_release(uuid, text),
  public.gate_pass_scrap_weigh(uuid, jsonb, text, text, text),
  public.gate_pass_request_emergency(uuid, text),
  public.gate_pass_emergency_review(uuid, boolean, timestamptz, text),
  public.gate_pass_hours_save(time, time, time, time, smallint[])
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.gate_pass_notify_super_admins(public.gate_passes),
  public.gate_pass_emergency_valid(public.gate_passes)
FROM PUBLIC, anon, authenticated;
