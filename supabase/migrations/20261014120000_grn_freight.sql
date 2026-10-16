-- ============================================================================
-- GRN — inward freight voucher
-- ----------------------------------------------------------------------------
-- The same freight voucher as the sales gate pass (20261012130000), now for
-- goods coming IN against a purchase order. Whoever makes the GRN records who
-- paid for the vehicle:
--
--   supplier_vehicle  supplier's own vehicle / freight included in the price
--                     → nothing
--   supplier_billed   the supplier charged freight on his bill
--                     → added to the GRN total (transportation_cost), so it is
--                       part of the supplier's payable — as before
--   company           we paid the transporter
--                     → freight voucher FV-… (UNPAID) made when the freight is
--                       saved; NOT in the supplier's payable
--   company_recover   we paid the transporter on the supplier's behalf ("to
--                     pay" bilty) and deduct it from his bill
--                     → freight voucher, and the GRN's ledger posting credits
--                       the supplier's payable that much less (postGRNVoucher)
--   other_grn         same vehicle, the trip was recorded on another GRN
--                     → nothing; points at that GRN
--
-- The voucher lives in gate_pass_freight_vouchers with direction = 'inward'
-- and grn_id set, so it shares the FV- series, the transporter list, the
-- Freight Vouchers page, Pay selected statements (FPS-), cancel and the
-- morning reminder with the outward vouchers.
--
-- The GRN maker can read inward vouchers and transporters (to print the
-- voucher); everything else keeps the read rule of 20261012130000.
--
-- Plan: docs/GRN_FREIGHT_VOUCHER_PLAN.md. Rollback:
-- supabase/rollbacks/20261014120000_grn_freight_down.sql.
--
-- Redefines gate_pass_freight_mode_label, gate_pass_freight_transporter,
-- gate_pass_transporter_save, gate_pass_freight_voucher_pay,
-- gate_pass_freight_pay_selected and gate_pass_freight_voucher_cancel
-- (all from 20261012130000_gate_pass_freight.sql): the new mode
-- 'goods_company', and no gate pass history line for an inward voucher.
-- ============================================================================

-- 1. Mode: goods company (bilty) ---------------------------------------------

ALTER TABLE public.gate_pass_transporters DROP CONSTRAINT IF EXISTS gate_pass_transporters_default_mode_check;
ALTER TABLE public.gate_pass_transporters ADD CONSTRAINT gate_pass_transporters_default_mode_check
  CHECK (default_mode IN ('contractor_van','online_rickshaw','bike','goods_company'));

ALTER TABLE public.gate_pass_freight_vouchers DROP CONSTRAINT IF EXISTS gate_pass_freight_vouchers_mode_check;
ALTER TABLE public.gate_pass_freight_vouchers ADD CONSTRAINT gate_pass_freight_vouchers_mode_check
  CHECK (mode IN ('contractor_van','online_rickshaw','bike','goods_company'));

CREATE OR REPLACE FUNCTION public.gate_pass_freight_mode_label(p_mode text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_mode WHEN 'contractor_van' THEN 'Contractor van' WHEN 'online_rickshaw' THEN 'Online rickshaw'
                        WHEN 'bike' THEN 'Bike' WHEN 'goods_company' THEN 'Goods company (bilty)'
                        ELSE COALESCE(p_mode, '') END; $$;

-- 2. Vouchers: outward (gate pass) or inward (GRN) -----------------------------

ALTER TABLE public.gate_pass_freight_vouchers ALTER COLUMN gate_pass_id DROP NOT NULL;
ALTER TABLE public.gate_pass_freight_vouchers
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outward',
  ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES public.goods_receipt_notes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grn_number text,
  ADD COLUMN IF NOT EXISTS po_number text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS gate_inward_number text,
  ADD COLUMN IF NOT EXISTS recover_from_supplier boolean NOT NULL DEFAULT false;

ALTER TABLE public.gate_pass_freight_vouchers DROP CONSTRAINT IF EXISTS gate_pass_freight_vouchers_direction_check;
ALTER TABLE public.gate_pass_freight_vouchers ADD CONSTRAINT gate_pass_freight_vouchers_direction_check
  CHECK ((direction = 'outward' AND gate_pass_id IS NOT NULL AND grn_id IS NULL AND NOT recover_from_supplier)
      OR (direction = 'inward' AND gate_pass_id IS NULL));

-- Only one live (unpaid or paid) voucher per GRN.
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_freight_vouchers_grn_live_uk
  ON public.gate_pass_freight_vouchers (grn_id) WHERE status <> 'cancelled' AND grn_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gate_pass_freight_vouchers_direction_idx
  ON public.gate_pass_freight_vouchers (direction, status, voucher_date);

-- 3. The freight recorded on a GRN (one row per GRN) ------------------------------

CREATE TABLE IF NOT EXISTS public.grn_freight (
  grn_id uuid PRIMARY KEY REFERENCES public.goods_receipt_notes(id) ON DELETE CASCADE,
  payer text NOT NULL
    CHECK (payer IN ('supplier_vehicle','supplier_billed','company','company_recover','other_grn')),
  mode text CHECK (mode IN ('contractor_van','online_rickshaw','bike','goods_company')),
  transporter_id uuid REFERENCES public.gate_pass_transporters(id) ON DELETE RESTRICT,
  transporter_name text,
  -- company / company_recover: paid to the transporter; supplier_billed: on the supplier's bill
  amount numeric CHECK (amount IS NULL OR amount >= 0),
  booking_ref text,                 -- app ride number or bilty number
  driver_name text,
  driver_contact text,
  vehicle_number text,
  shared_grn_id uuid REFERENCES public.goods_receipt_notes(id) ON DELETE SET NULL,  -- other_grn
  note text,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payer NOT IN ('company','company_recover')
         OR (mode IS NOT NULL AND amount > 0 AND transporter_name IS NOT NULL)),
  CHECK (payer <> 'supplier_billed' OR amount > 0)
);
CREATE INDEX IF NOT EXISTS grn_freight_shared_idx ON public.grn_freight (shared_grn_id);

-- 4. Roles --------------------------------------------------------------------
-- enter  → whoever makes GRNs: record freight on a new GRN, print the voucher
-- manage → change freight on someone else's GRN, cancel an inward voucher
CREATE OR REPLACE FUNCTION public.grn_freight_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE p_action
    WHEN 'enter' THEN public.gate_pass_has_any_role(ARRAY['super_admin','admin','purchase_manager','purchase_officer',
                                                         'accounting_officer','store_operator','gate_pass_manager'])
                      OR public.has_module_permission(public.app_user_id(), 'purchase', 'create')
    WHEN 'manage' THEN public.gate_pass_has_any_role(ARRAY['super_admin','purchase_manager','gate_pass_manager'])
    ELSE false END;
$$;

-- Read: the freight readers of 20261012130000, plus the GRN makers for the
-- inward side (vouchers, their history, the transporter list).
ALTER TABLE public.grn_freight ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read grn_freight" ON public.grn_freight;
CREATE POLICY "Read grn_freight" ON public.grn_freight FOR SELECT TO public
  USING (public.gate_pass_freight_can('read') OR public.grn_freight_can('enter'));
GRANT SELECT ON public.grn_freight TO anon, authenticated, service_role;
GRANT ALL ON public.grn_freight TO service_role;

DROP POLICY IF EXISTS "Read gate_pass_freight_vouchers" ON public.gate_pass_freight_vouchers;
CREATE POLICY "Read gate_pass_freight_vouchers" ON public.gate_pass_freight_vouchers FOR SELECT TO public
  USING (public.gate_pass_freight_can('read') OR (direction = 'inward' AND public.grn_freight_can('enter')));

DROP POLICY IF EXISTS "Read gate_pass_freight_voucher_events" ON public.gate_pass_freight_voucher_events;
CREATE POLICY "Read gate_pass_freight_voucher_events" ON public.gate_pass_freight_voucher_events FOR SELECT TO public
  USING (public.gate_pass_freight_can('read')
         OR (public.grn_freight_can('enter') AND EXISTS (
               SELECT 1 FROM public.gate_pass_freight_vouchers v WHERE v.id = voucher_id AND v.direction = 'inward')));

DROP POLICY IF EXISTS "Read gate_pass_transporters" ON public.gate_pass_transporters;
CREATE POLICY "Read gate_pass_transporters" ON public.gate_pass_transporters FOR SELECT TO public
  USING (public.gate_pass_freight_can('read') OR public.grn_freight_can('enter'));

-- 5. View: the inward freight log -------------------------------------------------
-- One row per GRN with freight recorded, with its live voucher.

DROP VIEW IF EXISTS public.v_grn_freight_log;
CREATE VIEW public.v_grn_freight_log
WITH (security_invoker = true) AS
SELECT n.id AS grn_id, n.grn_number, n.receipt_date, n.supplier_id, s.name AS supplier_name,
       po.po_number, n.received_by AS grn_created_by,
       f.payer, f.mode, f.transporter_id, f.transporter_name, f.amount, f.booking_ref,
       f.driver_name, f.driver_contact, f.vehicle_number, f.note,
       f.shared_grn_id, sg.grn_number AS shared_grn_number,
       v.id AS voucher_id, v.voucher_number, v.status AS voucher_status, v.voucher_date,
       v.paid_date, v.paid_amount, v.paid_by, v.statement_id
  FROM public.goods_receipt_notes n
  JOIN public.grn_freight f ON f.grn_id = n.id
  LEFT JOIN public.suppliers s ON s.id = n.supplier_id
  LEFT JOIN public.purchase_orders po ON po.id = n.purchase_order_id
  LEFT JOIN public.goods_receipt_notes sg ON sg.id = f.shared_grn_id
  LEFT JOIN public.gate_pass_freight_vouchers v ON v.grn_id = n.id AND v.status <> 'cancelled';

GRANT SELECT ON public.v_grn_freight_log TO anon, authenticated, service_role;

-- 6. Transporters: the new mode ----------------------------------------------------

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
            CASE WHEN p_mode IN ('contractor_van','online_rickshaw','bike','goods_company') THEN p_mode ELSE 'contractor_van' END,
            public.app_user_id())
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$;

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
  IF v_mode NOT IN ('contractor_van','online_rickshaw','bike','goods_company') THEN
    RAISE EXCEPTION 'Choose the usual mode: contractor van, online rickshaw, bike or goods company.';
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

-- 7. The inward voucher -----------------------------------------------------------
-- Internal: called from grn_freight_save. Idempotent: one live voucher per GRN.
CREATE OR REPLACE FUNCTION public.grn_freight_voucher_create(p_grn_id uuid, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  n public.goods_receipt_notes%ROWTYPE;
  f public.grn_freight%ROWTYPE;
  v_id uuid;
  v_num text;
  v_prev uuid;
  v_supplier text;
  v_po text;
  v_gin text;
  v_msg text;
BEGIN
  SELECT * INTO n FROM public.goods_receipt_notes WHERE id = p_grn_id;
  SELECT * INTO f FROM public.grn_freight WHERE grn_id = p_grn_id;
  IF NOT FOUND OR f.payer NOT IN ('company','company_recover') THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gate_pass_freight_vouchers WHERE grn_id = p_grn_id AND status <> 'cancelled') THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_prev FROM public.gate_pass_freight_vouchers
   WHERE grn_id = p_grn_id AND status = 'cancelled' ORDER BY created_at DESC LIMIT 1;
  SELECT name INTO v_supplier FROM public.suppliers WHERE id = n.supplier_id;
  SELECT po_number INTO v_po FROM public.purchase_orders WHERE id = n.purchase_order_id;
  SELECT entry_number INTO v_gin FROM public.gate_inward_entries WHERE id = n.gate_inward_id;

  v_num := 'FV-' || lpad(nextval('public.gate_pass_freight_voucher_seq')::text, 6, '0');
  INSERT INTO public.gate_pass_freight_vouchers
    (voucher_number, direction, grn_id, grn_number, po_number, supplier_id, supplier_name, gate_inward_number,
     recover_from_supplier, voucher_date, mode, transporter_id, transporter_name,
     driver_name, driver_contact, vehicle_number, booking_ref, amount, note, replaces_voucher_id, created_by)
  VALUES (v_num, 'inward', n.id, n.grn_number, v_po, n.supplier_id, v_supplier, v_gin,
          f.payer = 'company_recover', COALESCE(n.receipt_date, (now() AT TIME ZONE 'Asia/Karachi')::date),
          f.mode, f.transporter_id, f.transporter_name,
          f.driver_name, f.driver_contact, f.vehicle_number, f.booking_ref, f.amount, f.note, v_prev, v_uid)
  RETURNING id INTO v_id;

  v_msg := v_num || ' · Rs ' || to_char(f.amount, 'FM999,999,990') || ' · ' || f.transporter_name
           || ' · ' || public.gate_pass_freight_mode_label(f.mode) || ' · inward for ' || n.grn_number
           || COALESCE(' (' || v_supplier || ')', '')
           || CASE WHEN f.payer = 'company_recover' THEN ' · recover from supplier' ELSE '' END;
  PERFORM public.gate_pass_freight_voucher_log(v_id, CASE WHEN v_prev IS NULL THEN 'created' ELSE 'reissued' END,
    COALESCE(p_reason, 'Made on GRN ' || n.grn_number));

  PERFORM public.notify_role(ARRAY['super_admin','gate_pass_manager']::app_role[],
    'Freight voucher to pay', v_msg, 'info', 'gate_pass', '/gate-pass/freight?voucher=' || v_id::text,
    'gate_pass_freight_voucher', v_id, v_uid, v_uid);
  PERFORM public.notify_role(ARRAY['accounting_poster','accounting_officer','accounting_manager']::app_role[],
    'Freight voucher to pay', v_msg, 'info', 'accounting', '/accounting/freight-vouchers?voucher=' || v_id::text,
    'gate_pass_freight_voucher', v_id, v_uid, v_uid);
  PERFORM public.notify_role(ARRAY['pettycash_handler']::app_role[],
    'Freight voucher to pay', v_msg, 'info', 'expenses', '/expenses/freight-vouchers?voucher=' || v_id::text,
    'gate_pass_freight_voucher', v_id, v_uid, v_uid);
  RETURN v_id;
END;
$$;

-- 8. Recording the freight on a GRN ------------------------------------------------
-- p_data: { payer*, mode, transporter_id | transporter_name (+ transporter_kind, transporter_phone),
--           amount, booking_ref, driver_name, driver_contact, vehicle_number,
--           shared_grn_id (other_grn), note, reason (when changing) }
-- First time: whoever can make a GRN. Changing it later: the GRN maker or a
-- manager, with a reason. Keeps the GRN total (supplier-billed freight) and the
-- live voucher in step; a paid voucher is never changed here (cancel it first).
-- Returns the live voucher id, if any.
CREATE OR REPLACE FUNCTION public.grn_freight_save(p_grn_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  n public.goods_receipt_notes%ROWTYPE;
  f public.grn_freight%ROWTYPE;
  v public.gate_pass_freight_vouchers%ROWTYPE;
  v_exists boolean;
  v_payer text := NULLIF(p_data->>'payer', '');
  v_mode text := NULLIF(p_data->>'mode', '');
  v_amount numeric := NULLIF(p_data->>'amount', '')::numeric;
  v_tid uuid := NULLIF(p_data->>'transporter_id', '')::uuid;
  v_tname text;
  v_shared uuid := NULLIF(p_data->>'shared_grn_id', '')::uuid;
  v_shared_payer text;
  v_reason text := NULLIF(btrim(p_data->>'reason'), '');
  v_inward public.gate_inward_entries%ROWTYPE;
  v_driver text := NULLIF(btrim(p_data->>'driver_name'), '');
  v_contact text := NULLIF(btrim(p_data->>'driver_contact'), '');
  v_vehicle text := NULLIF(btrim(p_data->>'vehicle_number'), '');
  v_subtotal numeric;
  v_paying boolean;
BEGIN
  SELECT * INTO n FROM public.goods_receipt_notes WHERE id = p_grn_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'GRN not found.';
  END IF;
  IF NOT public.grn_freight_can('enter') THEN
    RAISE EXCEPTION 'You do not have permission to record freight on a GRN.';
  END IF;

  SELECT * INTO f FROM public.grn_freight WHERE grn_id = p_grn_id;
  v_exists := FOUND;
  IF v_exists THEN
    IF n.received_by IS DISTINCT FROM v_uid AND NOT public.grn_freight_can('manage') THEN
      RAISE EXCEPTION 'Only the person who made this GRN or a manager can change its freight.';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Give a reason for changing the freight.';
    END IF;
  END IF;

  IF v_payer IS NULL OR v_payer NOT IN ('supplier_vehicle','supplier_billed','company','company_recover','other_grn') THEN
    RAISE EXCEPTION 'Say who paid the freight.';
  END IF;
  v_paying := v_payer IN ('company','company_recover');

  -- Driver and vehicle: typed, else from the gate inward entry.
  IF n.gate_inward_id IS NOT NULL THEN
    SELECT * INTO v_inward FROM public.gate_inward_entries WHERE id = n.gate_inward_id;
    v_driver := COALESCE(v_driver, v_inward.driver_name);
    v_contact := COALESCE(v_contact, v_inward.driver_contact);
    v_vehicle := COALESCE(v_vehicle, v_inward.vehicle_number);
  END IF;

  IF v_paying THEN
    IF v_mode IS NULL OR v_mode NOT IN ('contractor_van','online_rickshaw','bike','goods_company') THEN
      RAISE EXCEPTION 'Choose how the goods came: contractor van, online rickshaw, bike or goods company.';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Enter the freight amount paid to the transporter.';
    END IF;
    v_tid := public.gate_pass_freight_transporter(v_tid, p_data->>'transporter_name', p_data->>'transporter_kind',
                                                  v_mode, p_data->>'transporter_phone');
    SELECT name INTO v_tname FROM public.gate_pass_transporters WHERE id = v_tid;
    v_shared := NULL;
  ELSIF v_payer = 'supplier_billed' THEN
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Enter the freight on the supplier''s bill.';
    END IF;
    v_mode := NULL; v_tid := NULL; v_tname := NULL; v_shared := NULL;
  ELSIF v_payer = 'other_grn' THEN
    IF v_shared IS NULL THEN
      RAISE EXCEPTION 'Choose the GRN the freight of this vehicle was recorded on.';
    END IF;
    IF v_shared = p_grn_id THEN
      RAISE EXCEPTION 'Choose another GRN, not this one.';
    END IF;
    SELECT payer INTO v_shared_payer FROM public.grn_freight WHERE grn_id = v_shared;
    IF v_shared_payer IS NULL OR v_shared_payer NOT IN ('company','company_recover') THEN
      RAISE EXCEPTION 'That GRN has no company-paid freight to share.';
    END IF;
    v_mode := NULL; v_amount := NULL; v_tid := NULL; v_tname := NULL;
  ELSE
    v_mode := NULL; v_amount := NULL; v_tid := NULL; v_tname := NULL; v_shared := NULL;
  END IF;

  -- A paid voucher is frozen: the money it records cannot change from here.
  SELECT * INTO v FROM public.gate_pass_freight_vouchers WHERE grn_id = p_grn_id AND status <> 'cancelled';
  IF FOUND AND v.status = 'paid'
     AND (NOT v_paying OR v.amount IS DISTINCT FROM v_amount OR v.transporter_id IS DISTINCT FROM v_tid
          OR v.mode IS DISTINCT FROM v_mode OR v.recover_from_supplier <> (v_payer = 'company_recover')) THEN
    RAISE EXCEPTION 'Voucher % is already paid. Ask a manager to cancel it first, then change the freight.', v.voucher_number;
  END IF;
  IF NOT v_paying AND EXISTS (SELECT 1 FROM public.grn_freight WHERE shared_grn_id = p_grn_id) THEN
    RAISE EXCEPTION 'Other GRNs of this vehicle point at this one for their freight. Change them first.';
  END IF;

  INSERT INTO public.grn_freight
    (grn_id, payer, mode, transporter_id, transporter_name, amount, booking_ref, driver_name, driver_contact,
     vehicle_number, shared_grn_id, note, updated_by, updated_at)
  VALUES (p_grn_id, v_payer, v_mode, v_tid, v_tname, v_amount, NULLIF(btrim(p_data->>'booking_ref'), ''),
          v_driver, v_contact, v_vehicle, v_shared, NULLIF(btrim(p_data->>'note'), ''), v_uid, now())
  ON CONFLICT (grn_id) DO UPDATE
    SET payer = EXCLUDED.payer, mode = EXCLUDED.mode, transporter_id = EXCLUDED.transporter_id,
        transporter_name = EXCLUDED.transporter_name, amount = EXCLUDED.amount, booking_ref = EXCLUDED.booking_ref,
        driver_name = EXCLUDED.driver_name, driver_contact = EXCLUDED.driver_contact,
        vehicle_number = EXCLUDED.vehicle_number, shared_grn_id = EXCLUDED.shared_grn_id,
        note = EXCLUDED.note, updated_by = v_uid, updated_at = now();

  -- The GRN total carries only the freight the supplier billed.
  SELECT COALESCE(sum(amount), 0) INTO v_subtotal FROM public.grn_items WHERE grn_id = p_grn_id;
  UPDATE public.goods_receipt_notes
     SET transportation_cost = CASE WHEN v_payer = 'supplier_billed' THEN v_amount ELSE 0 END,
         total_amount = v_subtotal + CASE WHEN v_payer = 'supplier_billed' THEN v_amount ELSE 0 END
   WHERE id = p_grn_id;

  -- Keep the live voucher in step.
  IF v.id IS NOT NULL THEN
    IF NOT v_paying THEN
      UPDATE public.gate_pass_freight_vouchers
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid,
             cancel_reason = COALESCE(v_reason, 'Freight changed'), updated_at = now()
       WHERE id = v.id;
      PERFORM public.gate_pass_freight_voucher_log(v.id, 'cancelled', 'Freight on the GRN changed: ' || COALESCE(v_reason, ''));
      RETURN NULL;
    END IF;
    IF v.status = 'unpaid' THEN
      UPDATE public.gate_pass_freight_vouchers
         SET mode = v_mode, transporter_id = v_tid, transporter_name = v_tname, amount = v_amount,
             recover_from_supplier = (v_payer = 'company_recover'),
             booking_ref = NULLIF(btrim(p_data->>'booking_ref'), ''), note = NULLIF(btrim(p_data->>'note'), ''),
             driver_name = v_driver, driver_contact = v_contact, vehicle_number = v_vehicle, updated_at = now()
       WHERE id = v.id;
      PERFORM public.gate_pass_freight_voucher_log(v.id, 'corrected', v_reason,
        jsonb_build_object('before', jsonb_build_object('mode', v.mode, 'transporter_name', v.transporter_name,
          'amount', v.amount, 'recover_from_supplier', v.recover_from_supplier, 'booking_ref', v.booking_ref,
          'note', v.note, 'driver_name', v.driver_name, 'driver_contact', v.driver_contact)));
    END IF;
    RETURN v.id;
  END IF;

  IF v_paying THEN
    RETURN public.grn_freight_voucher_create(p_grn_id, v_reason);
  END IF;
  RETURN NULL;
END;
$$;

-- 9. A GRN with a paid voucher cannot be deleted; an unpaid one is cancelled. ----

CREATE OR REPLACE FUNCTION public.grn_freight_before_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.gate_pass_freight_vouchers%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.gate_pass_freight_vouchers WHERE grn_id = OLD.id AND status <> 'cancelled';
  IF FOUND THEN
    IF v.status = 'paid' THEN
      RAISE EXCEPTION 'GRN % has freight voucher % paid. Cancel the voucher first.', OLD.grn_number, v.voucher_number;
    END IF;
    UPDATE public.gate_pass_freight_vouchers
       SET status = 'cancelled', cancelled_at = now(), cancelled_by = public.app_user_id(),
           cancel_reason = 'GRN ' || OLD.grn_number || ' deleted', updated_at = now()
     WHERE id = v.id;
    PERFORM public.gate_pass_freight_voucher_log(v.id, 'cancelled', 'GRN ' || OLD.grn_number || ' deleted');
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_grn_freight_before_delete ON public.goods_receipt_notes;
CREATE TRIGGER trg_grn_freight_before_delete
  BEFORE DELETE ON public.goods_receipt_notes
  FOR EACH ROW EXECUTE FUNCTION public.grn_freight_before_delete();

-- 10. Paying and cancelling: no gate pass history line for an inward voucher ------

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
  IF v.gate_pass_id IS NOT NULL THEN
    PERFORM public.gate_pass_log(v.gate_pass_id, 'freight_paid',
      v.voucher_number || ' paid Rs ' || to_char(v_amount, 'FM999,999,990') || ' to ' || v.transporter_name);
  END IF;
END;
$$;

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
    IF v.gate_pass_id IS NOT NULL THEN
      PERFORM public.gate_pass_log(v.gate_pass_id, 'freight_paid',
        v.voucher_number || ' paid to ' || v.transporter_name || ' on statement ' || v_num);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('id', v_sid, 'statement_number', v_num, 'total_amount', v_total, 'voucher_count', v_n);
END;
$$;

-- Cancel: gate pass managers for any voucher; purchase managers for inward ones.
CREATE OR REPLACE FUNCTION public.gate_pass_freight_voucher_cancel(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.gate_pass_freight_vouchers%ROWTYPE;
  v_uid uuid := public.app_user_id();
BEGIN
  IF NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for cancelling the voucher.';
  END IF;
  SELECT * INTO v FROM public.gate_pass_freight_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Voucher not found.';
  END IF;
  IF NOT (public.gate_pass_freight_can('manage') OR (v.direction = 'inward' AND public.grn_freight_can('manage'))) THEN
    RAISE EXCEPTION 'Only a manager can cancel a freight voucher.';
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
  IF v.gate_pass_id IS NOT NULL THEN
    PERFORM public.gate_pass_log(v.gate_pass_id, 'freight_voucher_cancelled', v.voucher_number || ': ' || btrim(p_reason));
  END IF;
END;
$$;

-- 11. Ledger slot for the later phase and for recovered freight -------------------
-- Inward freight is an expense ("Freight Inward / Carriage Inward"). A GRN whose
-- freight is recovered from the supplier credits this account in its purchase
-- posting, so the cash paid to the transporter nets to nil there and the
-- supplier is owed that much less. Mapped on Accounting → Default Accounts.

-- 12. Permissions --------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.grn_freight_can(text),
  public.grn_freight_save(uuid, jsonb),
  public.gate_pass_freight_mode_label(text),
  public.gate_pass_transporter_save(uuid, jsonb),
  public.gate_pass_freight_voucher_pay(uuid, jsonb),
  public.gate_pass_freight_pay_selected(uuid[], jsonb),
  public.gate_pass_freight_voucher_cancel(uuid, text)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.grn_freight_voucher_create(uuid, text),
  public.grn_freight_before_delete(),
  public.gate_pass_freight_transporter(uuid, text, text, text, text)
FROM PUBLIC, anon, authenticated;
