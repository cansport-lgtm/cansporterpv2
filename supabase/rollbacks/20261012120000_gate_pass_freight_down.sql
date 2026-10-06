-- ============================================================================
-- Rollback of 20261012120000_gate_pass_freight.sql
-- ----------------------------------------------------------------------------
-- Restores gate_pass_save, gate_pass_submit and gate_pass_mark_out as they
-- were before (verbatim copies of 20260929120000_gate_pass_phase2_3.sql,
-- 20261009120000_gate_pass_sample_no_self_approval.sql and
-- 20261011120000_gate_out_delivers_dispatch.sql), then drops the freight
-- functions, view, tables and the reminder job. The gate pass events written
-- by the feature (freight_saved, freight_voucher, freight_paid …) stay in the
-- pass history.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gate-pass-freight-unpaid';
  END IF;
END $$;

-- 1. gate_pass_mark_out as in 20261011120000_gate_out_delivers_dispatch.sql
CREATE OR REPLACE FUNCTION public.gate_pass_mark_out(p_id uuid, p_at timestamptz DEFAULT now())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  i public.gate_pass_items%ROWTYPE;
  v_day date := (p_at AT TIME ZONE 'Asia/Karachi')::date;
  v_loc uuid;
BEGIN
  UPDATE public.gate_passes
     SET status = 'out', gate_out_by = v_uid, gate_out_at = p_at, updated_at = now()
   WHERE id = p_id
  RETURNING * INTO g;

  IF g.pass_type = 'sample' THEN
    INSERT INTO public.stock_movements
      (movement_number, movement_type, movement_date, item_type, item_id, quantity,
       reference_type, reference_id, reference_number, remarks, status, created_by)
    SELECT '', 'issue', v_day, 'finished_goods', it.product_id,
           CASE it.uom WHEN 'pcs' THEN it.quantity / 12 ELSE it.quantity END,
           'gate_pass', g.id, g.pass_number,
           'Sample to ' || g.party_name || ' (' || it.quantity || ' ' || it.uom || ')',
           'completed', v_uid
      FROM public.gate_pass_items it
     WHERE it.gate_pass_id = g.id AND it.product_id IS NOT NULL AND it.quantity > 0;
  ELSIF g.pass_type = 'sales' THEN
    -- The gate scan is the delivery: the dispatches on the pass are Delivered,
    -- dated on the day the vehicle left.
    UPDATE public.sales_dispatches sd
       SET delivery_status = 'delivered',
           actual_delivery_date = COALESCE(sd.actual_delivery_date, v_day)
      FROM public.gate_pass_dispatches gd
     WHERE gd.gate_pass_id = g.id AND sd.id = gd.dispatch_id
       AND sd.delivery_status IN ('pending', 'in_transit');
  ELSIF g.pass_type IN ('returnable','job_work') THEN
    v_loc := public.gate_pass_location(CASE g.pass_type WHEN 'returnable' THEN 'GP-REPAIR' ELSE 'GP-JOBWORK' END);
    FOR i IN SELECT * FROM public.gate_pass_items WHERE gate_pass_id = g.id AND quantity > 0 LOOP
      PERFORM public.gate_pass_move('transfer', i.product_id, i.item_id, i.quantity, NULL, v_loc, v_day, g,
        initcap(replace(g.pass_type, '_', ' ')) || ' to ' || g.party_name);
      IF i.spare_part_id IS NOT NULL THEN
        UPDATE public.spare_parts SET current_stock = COALESCE(current_stock, 0) - i.quantity::integer
         WHERE id = i.spare_part_id;
      END IF;
    END LOOP;
  ELSIF g.pass_type = 'scrap' THEN
    INSERT INTO public.gate_pass_scrap_entries
      (category_id, entry_type, entry_date, quantity, gate_pass_id, remarks, created_by)
    SELECT it.scrap_category_id, 'out', v_day, it.quantity, g.id,
           g.pass_number || ' to ' || g.party_name, v_uid
      FROM public.gate_pass_items it
     WHERE it.gate_pass_id = g.id AND it.scrap_category_id IS NOT NULL AND it.quantity > 0;
  END IF;

  PERFORM public.gate_pass_log(p_id, 'out', CASE WHEN g.is_backfill THEN 'Left on the paper pass' ELSE 'Vehicle left the gate' END);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.gate_pass_mark_out(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- 2. gate_pass_submit as in 20261009120000_gate_pass_sample_no_self_approval.sql
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

-- 3. gate_pass_save as in 20260929120000_gate_pass_phase2_3.sql
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


GRANT EXECUTE ON FUNCTION public.gate_pass_save(uuid, jsonb, boolean), public.gate_pass_submit(uuid)
TO anon, authenticated, service_role;

-- 4. Freight objects -----------------------------------------------------------

DROP FUNCTION IF EXISTS public.gate_pass_freight_notify_unpaid();
DROP FUNCTION IF EXISTS public.gate_pass_freight_settings_save(integer);
DROP FUNCTION IF EXISTS public.gate_pass_freight_voucher_cancel(uuid, text);
DROP FUNCTION IF EXISTS public.gate_pass_freight_pay_selected(uuid[], jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_freight_voucher_pay(uuid, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_freight_voucher_create(public.gate_passes, timestamptz, text);
DROP FUNCTION IF EXISTS public.gate_pass_freight_check(uuid);
DROP FUNCTION IF EXISTS public.gate_pass_freight_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_transporter_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_freight_transporter(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.gate_pass_freight_voucher_log(uuid, text, text, jsonb);
DROP FUNCTION IF EXISTS public.gate_pass_freight_mode_label(text);

DROP VIEW IF EXISTS public.v_gate_pass_freight_log;

DROP TABLE IF EXISTS public.gate_pass_freight_voucher_events;
DROP TABLE IF EXISTS public.gate_pass_freight_vouchers;
DROP TABLE IF EXISTS public.gate_pass_freight_statements;
DROP TABLE IF EXISTS public.gate_pass_freight;
DROP TABLE IF EXISTS public.gate_pass_transporters;

DROP FUNCTION IF EXISTS public.gate_pass_freight_can(text);

DROP SEQUENCE IF EXISTS public.gate_pass_freight_voucher_seq;
DROP SEQUENCE IF EXISTS public.gate_pass_freight_statement_seq;

ALTER TABLE public.gate_pass_settings DROP COLUMN IF EXISTS freight_reminder_days;
