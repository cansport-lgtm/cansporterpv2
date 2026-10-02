-- Rollback for 20261006120000_gate_pass_hours.sql
-- Restores save / submit / review / scrap weigh / gate check / release without
-- gate hours. The emergency_* columns and settings columns are dropped.

DROP FUNCTION IF EXISTS public.gate_pass_hours_save(time, time, time, time, smallint[]);
DROP FUNCTION IF EXISTS public.gate_pass_emergency_review(uuid, boolean, timestamptz, text);
DROP FUNCTION IF EXISTS public.gate_pass_request_emergency(uuid, text);

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
BEGIN
  IF NOT public.gate_pass_can('create') THEN
    RAISE EXCEPTION 'You do not have permission to make gate passes.';
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('sales','sample','supplier_return','returnable','job_work','scrap') THEN
    RAISE EXCEPTION 'Choose what is leaving.';
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
BEGIN
  IF NOT public.gate_pass_can('gate') THEN
    RAISE EXCEPTION 'Only gate security or a gate pass manager can weigh at the gate.';
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
BEGIN
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_id AND pass_type = 'scrap') THEN
    RAISE EXCEPTION 'A scrap pass is weighed at the gate, not counted.';
  END IF;
  RETURN public.gate_pass_gate_check_count(p_id, p_counts, p_vehicle, p_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.gate_pass_release(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_id AND pass_type = 'scrap') THEN
    RAISE EXCEPTION 'A held scrap pass cannot be released. Unload to the approved weight and weigh again, or cancel the pass.';
  END IF;
  PERFORM public.gate_pass_release_counted(p_id, p_reason);
END;
$$;

DROP FUNCTION IF EXISTS public.gate_pass_after_hours_hold(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_notify_super_admins(public.gate_passes);
DROP FUNCTION IF EXISTS public.gate_pass_emergency_valid(public.gate_passes);
DROP FUNCTION IF EXISTS public.gate_pass_hours();
DROP FUNCTION IF EXISTS public.gate_pass_closed_reason(text, text, timestamptz);

DROP INDEX IF EXISTS public.gate_passes_emergency_idx;
ALTER TABLE public.gate_passes
  DROP COLUMN IF EXISTS emergency_status, DROP COLUMN IF EXISTS emergency_reason,
  DROP COLUMN IF EXISTS emergency_requested_by, DROP COLUMN IF EXISTS emergency_requested_at,
  DROP COLUMN IF EXISTS emergency_decided_by, DROP COLUMN IF EXISTS emergency_decided_at,
  DROP COLUMN IF EXISTS emergency_valid_until, DROP COLUMN IF EXISTS emergency_remarks;
ALTER TABLE public.gate_pass_settings
  DROP COLUMN IF EXISTS sales_create_until, DROP COLUMN IF EXISTS sales_gate_until,
  DROP COLUMN IF EXISTS other_create_until, DROP COLUMN IF EXISTS other_gate_until,
  DROP COLUMN IF EXISTS closed_weekdays;
