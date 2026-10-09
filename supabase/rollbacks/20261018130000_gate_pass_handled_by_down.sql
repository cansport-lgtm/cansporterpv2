-- Rollback for 20261018130000_gate_pass_handled_by.sql: restore gate_pass_save
-- from 20261012130000_gate_pass_freight.sql, then drop the column.

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

  -- Freight (sales passes): who pays, mode, transporter, amount.
  IF v_type = 'sales' AND jsonb_typeof(p_data->'freight') = 'object' THEN
    PERFORM public.gate_pass_freight_save(v_id, p_data->'freight');
  END IF;
  IF v_type = 'sales' AND (v_bf IS NOT NULL OR p_submit) THEN
    PERFORM public.gate_pass_freight_check(v_id);
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

ALTER TABLE public.gate_passes DROP COLUMN IF EXISTS handled_by;
