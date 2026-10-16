-- ============================================================================
-- Rollback of 20261014120000_grn_freight.sql
-- ----------------------------------------------------------------------------
-- Drops the GRN freight (table, view, functions, delete trigger) and the
-- inward vouchers with their history, puts the voucher table back to
-- gate-pass-only, and restores the functions it redefined as they are in
-- 20261012130000_gate_pass_freight.sql (verbatim copies below). Transporters
-- whose usual mode is 'goods_company' go back to 'contractor_van'.
-- goods_receipt_notes.transportation_cost keeps whatever the GRN freight set.
-- ============================================================================

DROP TRIGGER IF EXISTS trg_grn_freight_before_delete ON public.goods_receipt_notes;
DROP FUNCTION IF EXISTS public.grn_freight_before_delete();
DROP FUNCTION IF EXISTS public.grn_freight_save(uuid, jsonb);
DROP FUNCTION IF EXISTS public.grn_freight_voucher_create(uuid, text);
DROP VIEW IF EXISTS public.v_grn_freight_log;
DROP TABLE IF EXISTS public.grn_freight;

-- Inward vouchers and the statements that paid only inward trips.
DELETE FROM public.gate_pass_freight_vouchers WHERE direction = 'inward';
DELETE FROM public.gate_pass_freight_statements s
 WHERE NOT EXISTS (SELECT 1 FROM public.gate_pass_freight_vouchers v WHERE v.statement_id = s.id);
UPDATE public.gate_pass_freight_statements s
   SET voucher_count = x.n, total_amount = x.total
  FROM (SELECT statement_id, count(*) AS n, sum(amount) AS total
          FROM public.gate_pass_freight_vouchers WHERE statement_id IS NOT NULL GROUP BY statement_id) x
 WHERE x.statement_id = s.id AND (s.voucher_count <> x.n OR s.total_amount <> x.total);

-- Read policies as in 20261012130000_gate_pass_freight.sql.
DROP POLICY IF EXISTS "Read gate_pass_freight_vouchers" ON public.gate_pass_freight_vouchers;
CREATE POLICY "Read gate_pass_freight_vouchers" ON public.gate_pass_freight_vouchers FOR SELECT TO public
  USING (public.gate_pass_freight_can('read'));
DROP POLICY IF EXISTS "Read gate_pass_freight_voucher_events" ON public.gate_pass_freight_voucher_events;
CREATE POLICY "Read gate_pass_freight_voucher_events" ON public.gate_pass_freight_voucher_events FOR SELECT TO public
  USING (public.gate_pass_freight_can('read'));
DROP POLICY IF EXISTS "Read gate_pass_transporters" ON public.gate_pass_transporters;
CREATE POLICY "Read gate_pass_transporters" ON public.gate_pass_transporters FOR SELECT TO public
  USING (public.gate_pass_freight_can('read'));

DROP INDEX IF EXISTS public.gate_pass_freight_vouchers_grn_live_uk;
DROP INDEX IF EXISTS public.gate_pass_freight_vouchers_direction_idx;
ALTER TABLE public.gate_pass_freight_vouchers DROP CONSTRAINT IF EXISTS gate_pass_freight_vouchers_direction_check;
ALTER TABLE public.gate_pass_freight_vouchers
  DROP COLUMN IF EXISTS direction,
  DROP COLUMN IF EXISTS grn_id,
  DROP COLUMN IF EXISTS grn_number,
  DROP COLUMN IF EXISTS po_number,
  DROP COLUMN IF EXISTS supplier_id,
  DROP COLUMN IF EXISTS supplier_name,
  DROP COLUMN IF EXISTS gate_inward_number,
  DROP COLUMN IF EXISTS recover_from_supplier;
ALTER TABLE public.gate_pass_freight_vouchers ALTER COLUMN gate_pass_id SET NOT NULL;

UPDATE public.gate_pass_transporters SET default_mode = 'contractor_van' WHERE default_mode = 'goods_company';
ALTER TABLE public.gate_pass_transporters DROP CONSTRAINT IF EXISTS gate_pass_transporters_default_mode_check;
ALTER TABLE public.gate_pass_transporters ADD CONSTRAINT gate_pass_transporters_default_mode_check
  CHECK (default_mode IN ('contractor_van','online_rickshaw','bike'));
ALTER TABLE public.gate_pass_freight_vouchers DROP CONSTRAINT IF EXISTS gate_pass_freight_vouchers_mode_check;
ALTER TABLE public.gate_pass_freight_vouchers ADD CONSTRAINT gate_pass_freight_vouchers_mode_check
  CHECK (mode IN ('contractor_van','online_rickshaw','bike'));

DROP FUNCTION IF EXISTS public.grn_freight_can(text);

-- Functions as in 20261012130000_gate_pass_freight.sql ------------------------

CREATE OR REPLACE FUNCTION public.gate_pass_freight_mode_label(p_mode text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_mode WHEN 'contractor_van' THEN 'Contractor van' WHEN 'online_rickshaw' THEN 'Online rickshaw'
                        WHEN 'bike' THEN 'Bike' ELSE COALESCE(p_mode, '') END; $$;

-- Find the transporter by name, or make it (a new name typed on a pass).
CREATE OR REPLACE FUNCTION public.gate_pass_freight_transporter(p_id uuid, p_name text, p_kind text, p_mode text, p_phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_name text := NULLIF(btrim(p_name), '');
BEGIN
  IF v_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.gate_pass_transporters WHERE id = v_id) THEN
      RAISE EXCEPTION 'Transporter not found.';
    END IF;
    RETURN v_id;
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Choose or type the transporter.';
  END IF;
  SELECT id INTO v_id FROM public.gate_pass_transporters WHERE lower(btrim(name)) = lower(v_name);
  IF v_id IS NULL THEN
    INSERT INTO public.gate_pass_transporters (name, phone, kind, default_mode, created_by)
    VALUES (v_name, NULLIF(btrim(p_phone), ''),
            CASE WHEN p_kind IN ('contractor','app') THEN p_kind
                 WHEN p_mode = 'online_rickshaw' THEN 'app' ELSE 'contractor' END,
            CASE WHEN p_mode IN ('contractor_van','online_rickshaw','bike') THEN p_mode ELSE 'contractor_van' END,
            public.app_user_id())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

-- p_data: { name*, phone, kind ('contractor'|'app'), default_mode, default_rate, is_active, remarks }
CREATE OR REPLACE FUNCTION public.gate_pass_transporter_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_name text := NULLIF(btrim(p_data->>'name'), '');
  v_kind text := COALESCE(NULLIF(p_data->>'kind', ''), 'contractor');
  v_mode text := COALESCE(NULLIF(p_data->>'default_mode', ''), 'contractor_van');
  v_rate numeric := NULLIF(p_data->>'default_rate', '')::numeric;
BEGIN
  IF NOT public.gate_pass_freight_can('manage') THEN
    RAISE EXCEPTION 'Only a gate pass manager can change transporters.';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Enter the transporter name.';
  END IF;
  IF v_kind NOT IN ('contractor','app') THEN
    RAISE EXCEPTION 'A transporter is a contractor or an app.';
  END IF;
  IF v_mode NOT IN ('contractor_van','online_rickshaw','bike') THEN
    RAISE EXCEPTION 'Choose the usual mode: contractor van, online rickshaw or bike.';
  END IF;
  IF v_rate IS NOT NULL AND v_rate < 0 THEN
    RAISE EXCEPTION 'The default rate cannot be negative.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gate_pass_transporters
              WHERE lower(btrim(name)) = lower(v_name) AND (v_id IS NULL OR id <> v_id)) THEN
    RAISE EXCEPTION 'A transporter called % already exists.', v_name;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.gate_pass_transporters (name, phone, kind, default_mode, default_rate, is_active, remarks, created_by)
    VALUES (v_name, NULLIF(btrim(p_data->>'phone'), ''), v_kind, v_mode, v_rate,
            COALESCE((p_data->>'is_active')::boolean, true), NULLIF(btrim(p_data->>'remarks'), ''), public.app_user_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.gate_pass_transporters
       SET name = v_name, phone = NULLIF(btrim(p_data->>'phone'), ''), kind = v_kind, default_mode = v_mode,
           default_rate = v_rate, is_active = COALESCE((p_data->>'is_active')::boolean, is_active),
           remarks = NULLIF(btrim(p_data->>'remarks'), ''), updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transporter not found.';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- p_data: { paid_date, paid_amount, photo_path, remark }
CREATE OR REPLACE FUNCTION public.gate_pass_freight_voucher_pay(p_id uuid, p_data jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.gate_pass_freight_vouchers%ROWTYPE;
  v_uid uuid := public.app_user_id();
  v_date date := COALESCE(NULLIF(p_data->>'paid_date', '')::date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_amount numeric;
  v_remark text := NULLIF(btrim(p_data->>'remark'), '');
BEGIN
  IF NOT public.gate_pass_freight_can('pay') THEN
    RAISE EXCEPTION 'Only the cashier can mark a freight voucher paid.';
  END IF;
  SELECT * INTO v FROM public.gate_pass_freight_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found.';
  END IF;
  IF v.status <> 'unpaid' THEN
    RAISE EXCEPTION 'Voucher % is already %.', v.voucher_number, v.status;
  END IF;
  v_amount := COALESCE(NULLIF(p_data->>'paid_amount', '')::numeric, v.amount);
  IF v_amount < 0 THEN
    RAISE EXCEPTION 'The amount paid cannot be negative.';
  END IF;
  IF v_amount <> v.amount AND v_remark IS NULL THEN
    RAISE EXCEPTION 'The amount paid differs from the voucher: say why in the remark.';
  END IF;
  IF v_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN
    RAISE EXCEPTION 'The paid date cannot be in the future.';
  END IF;

  UPDATE public.gate_pass_freight_vouchers
     SET status = 'paid', paid_date = v_date, paid_at = now(), paid_by = v_uid, paid_amount = v_amount,
         paid_photo_path = NULLIF(btrim(p_data->>'photo_path'), ''), paid_remark = v_remark, updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_freight_voucher_log(p_id, 'paid',
    'Paid Rs ' || to_char(v_amount, 'FM999,999,990') || ' on ' || to_char(v_date, 'DD Mon YYYY') || COALESCE(' — ' || v_remark, ''));
  PERFORM public.gate_pass_log(v.gate_pass_id, 'freight_paid',
    v.voucher_number || ' paid Rs ' || to_char(v_amount, 'FM999,999,990') || ' to ' || v.transporter_name);
END;
$$;

-- Several unpaid trips of ONE transporter paid together on a statement.
-- p_data: { paid_date, photo_path, remark }. Returns { id, statement_number, total_amount, voucher_count }.
CREATE OR REPLACE FUNCTION public.gate_pass_freight_pay_selected(p_ids uuid[], p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_date date := COALESCE(NULLIF(p_data->>'paid_date', '')::date, (now() AT TIME ZONE 'Asia/Karachi')::date);
  v_remark text := NULLIF(btrim(p_data->>'remark'), '');
  v_n integer;
  v_tids integer;
  v_tid uuid;
  v_tname text;
  v_total numeric;
  v_sid uuid;
  v_num text;
  v public.gate_pass_freight_vouchers%ROWTYPE;
BEGIN
  IF NOT public.gate_pass_freight_can('pay') THEN
    RAISE EXCEPTION 'Only the cashier can pay freight vouchers.';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RAISE EXCEPTION 'Tick the vouchers being paid.';
  END IF;
  IF v_date > (now() AT TIME ZONE 'Asia/Karachi')::date THEN
    RAISE EXCEPTION 'The paid date cannot be in the future.';
  END IF;

  PERFORM 1 FROM public.gate_pass_freight_vouchers WHERE id = ANY (p_ids) FOR UPDATE;
  SELECT count(*), count(DISTINCT COALESCE(transporter_id::text, lower(transporter_name))),
         min(transporter_id::text)::uuid, min(transporter_name), sum(amount)
    INTO v_n, v_tids, v_tid, v_tname, v_total
    FROM public.gate_pass_freight_vouchers
   WHERE id = ANY (p_ids) AND status = 'unpaid';
  IF v_n <> (SELECT count(DISTINCT x) FROM unnest(p_ids) x) THEN
    RAISE EXCEPTION 'One of the vouchers is no longer unpaid. Refresh and try again.';
  END IF;
  IF v_tids <> 1 THEN
    RAISE EXCEPTION 'A statement pays one transporter. Tick the vouchers of one transporter only.';
  END IF;

  v_num := 'FPS-' || lpad(nextval('public.gate_pass_freight_statement_seq')::text, 6, '0');
  INSERT INTO public.gate_pass_freight_statements
    (statement_number, transporter_id, transporter_name, paid_date, paid_by, total_amount, voucher_count, photo_path, remark)
  VALUES (v_num, v_tid, v_tname, v_date, v_uid, v_total, v_n, NULLIF(btrim(p_data->>'photo_path'), ''), v_remark)
  RETURNING id INTO v_sid;

  UPDATE public.gate_pass_freight_vouchers
     SET status = 'paid', paid_date = v_date, paid_at = now(), paid_by = v_uid, paid_amount = amount,
         paid_photo_path = NULLIF(btrim(p_data->>'photo_path'), ''), paid_remark = v_remark,
         statement_id = v_sid, updated_at = now()
   WHERE id = ANY (p_ids);

  FOR v IN SELECT * FROM public.gate_pass_freight_vouchers WHERE id = ANY (p_ids) LOOP
    PERFORM public.gate_pass_freight_voucher_log(v.id, 'paid',
      'Paid on statement ' || v_num || ' (' || to_char(v_date, 'DD Mon YYYY') || ')' || COALESCE(' — ' || v_remark, ''));
    PERFORM public.gate_pass_log(v.gate_pass_id, 'freight_paid',
      v.voucher_number || ' paid to ' || v.transporter_name || ' on statement ' || v_num);
  END LOOP;

  RETURN jsonb_build_object('id', v_sid, 'statement_number', v_num, 'total_amount', v_total, 'voucher_count', v_n);
END;
$$;

-- Cancel a voucher (unpaid or paid), with a reason. A new one can then be
-- made from the pass with gate_pass_freight_save (re-issue).
CREATE OR REPLACE FUNCTION public.gate_pass_freight_voucher_cancel(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.gate_pass_freight_vouchers%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  IF NOT public.gate_pass_freight_can('manage') THEN
    RAISE EXCEPTION 'Only a gate pass manager can cancel a freight voucher.';
  END IF;
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the voucher.';
  END IF;
  SELECT * INTO v FROM public.gate_pass_freight_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found.';
  END IF;
  IF v.status = 'cancelled' THEN
    RAISE EXCEPTION 'Voucher % is already cancelled.', v.voucher_number;
  END IF;
  UPDATE public.gate_pass_freight_vouchers
     SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = btrim(p_reason), updated_at = now()
   WHERE id = p_id;
  PERFORM public.gate_pass_freight_voucher_log(p_id, 'cancelled',
    CASE WHEN v.status = 'paid' THEN 'Cancelled after payment: ' ELSE 'Cancelled: ' END || btrim(p_reason),
    jsonb_build_object('was', v.status, 'paid_amount', v.paid_amount, 'statement_id', v.statement_id));
  PERFORM public.gate_pass_log(v.gate_pass_id, 'freight_voucher_cancelled', v.voucher_number || ': ' || btrim(p_reason));
END;
$$;
