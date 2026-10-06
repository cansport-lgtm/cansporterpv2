-- ============================================================================
-- Gate Pass — freight voucher at gate out
-- ----------------------------------------------------------------------------
-- Every sales dispatch leaves on a hired vehicle (contractor van, online
-- rickshaw / bike through an app) unless the customer's own vehicle collects
-- it. The office records the freight on the SALES gate pass while making it:
-- who pays, the mode, the transporter and the amount. When the vehicle goes
-- OUT at the gate, a freight voucher (FV-000001 …) is created automatically
-- as UNPAID. The driver / contractor collects cash against it later; the
-- cashier marks it PAID (one voucher, or several trips of a contractor at
-- once on a payment statement FPS-000001 …).
--
-- No accounting posting yet: the vouchers are a log, reconciled by hand with
-- the cash book. ledger_voucher_id is reserved for that later phase.
--
-- The guard never sees an amount: the freight, voucher and transporter rows
-- are readable by the office gate pass roles and the cashier roles only
-- (same rule as scrap rates). Nothing on the guard's screen changes.
--
-- Plan: docs/DISPATCH_FREIGHT_VOUCHER_PLAN.md. Rollback:
-- supabase/rollbacks/20261012130000_gate_pass_freight_down.sql.
--
-- Redefines gate_pass_save (20260929120000_gate_pass_phase2_3.sql),
-- gate_pass_submit (20261009120000_gate_pass_sample_no_self_approval.sql)
-- and gate_pass_mark_out (20261011120000_gate_out_delivers_dispatch.sql);
-- every other branch of those functions is unchanged.
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.gate_pass_freight_voucher_seq;
CREATE SEQUENCE IF NOT EXISTS public.gate_pass_freight_statement_seq;

-- Who carries the goods. One row per contractor (a known firm or person, paid
-- per trip and settled together) and one row per app (Bykea, InDrive, Careem…
-- the driver changes every ride, so the ride number is kept on the pass).
CREATE TABLE IF NOT EXISTS public.gate_pass_transporters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  kind text NOT NULL DEFAULT 'contractor' CHECK (kind IN ('contractor','app')),
  default_mode text NOT NULL DEFAULT 'contractor_van'
    CHECK (default_mode IN ('contractor_van','online_rickshaw','bike')),
  default_rate numeric CHECK (default_rate IS NULL OR default_rate >= 0),
  is_active boolean NOT NULL DEFAULT true,
  remarks text,
  -- Reserved for the ledger phase: the accounting party the vouchers post to.
  accounting_party_id uuid,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_transporters_name_uk
  ON public.gate_pass_transporters (lower(btrim(name)));

-- The freight the office entered on a sales pass (one row per pass).
CREATE TABLE IF NOT EXISTS public.gate_pass_freight (
  gate_pass_id uuid PRIMARY KEY REFERENCES public.gate_passes(id) ON DELETE CASCADE,
  payer text NOT NULL CHECK (payer IN ('company','customer','customer_vehicle')),
  mode text CHECK (mode IN ('contractor_van','online_rickshaw','bike')),
  transporter_id uuid REFERENCES public.gate_pass_transporters(id) ON DELETE RESTRICT,
  transporter_name text,
  amount numeric CHECK (amount IS NULL OR amount >= 0),
  booking_ref text,
  note text,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payer <> 'company' OR (mode IS NOT NULL AND amount > 0 AND transporter_name IS NOT NULL))
);

-- One payment of a contractor for several trips at once.
CREATE TABLE IF NOT EXISTS public.gate_pass_freight_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_number text NOT NULL UNIQUE,
  transporter_id uuid REFERENCES public.gate_pass_transporters(id) ON DELETE RESTRICT,
  transporter_name text NOT NULL,
  paid_date date NOT NULL,
  paid_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  voucher_count integer NOT NULL CHECK (voucher_count > 0),
  photo_path text,
  remark text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The voucher made at gate out. A snapshot of the pass at that moment, so the
-- log stays true even if the pass is edited later.
CREATE TABLE IF NOT EXISTS public.gate_pass_freight_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text NOT NULL UNIQUE,
  gate_pass_id uuid NOT NULL REFERENCES public.gate_passes(id) ON DELETE RESTRICT,
  voucher_date date NOT NULL,
  status text NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid','paid','cancelled')),
  mode text NOT NULL CHECK (mode IN ('contractor_van','online_rickshaw','bike')),
  transporter_id uuid REFERENCES public.gate_pass_transporters(id) ON DELETE RESTRICT,
  transporter_name text NOT NULL,
  driver_name text,
  driver_contact text,
  vehicle_number text,
  booking_ref text,
  dispatch_numbers text,
  customer_names text,
  amount numeric NOT NULL CHECK (amount > 0),
  note text,
  paid_date date,
  paid_at timestamptz,
  paid_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  paid_amount numeric CHECK (paid_amount IS NULL OR paid_amount >= 0),
  paid_photo_path text,
  paid_remark text,
  statement_id uuid REFERENCES public.gate_pass_freight_statements(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancel_reason text,
  replaces_voucher_id uuid REFERENCES public.gate_pass_freight_vouchers(id) ON DELETE SET NULL,
  -- Reserved: the accounting voucher this posts to, once the ledger phase is built.
  ledger_voucher_id uuid,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Only one live (unpaid or paid) voucher per pass.
CREATE UNIQUE INDEX IF NOT EXISTS gate_pass_freight_vouchers_live_uk
  ON public.gate_pass_freight_vouchers (gate_pass_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS gate_pass_freight_vouchers_status_idx
  ON public.gate_pass_freight_vouchers (status, voucher_date);
CREATE INDEX IF NOT EXISTS gate_pass_freight_vouchers_transporter_idx
  ON public.gate_pass_freight_vouchers (transporter_id, status);
CREATE INDEX IF NOT EXISTS gate_pass_freight_vouchers_statement_idx
  ON public.gate_pass_freight_vouchers (statement_id);

-- Everything that happened to a voucher, with before / after where it changed.
CREATE TABLE IF NOT EXISTS public.gate_pass_freight_voucher_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.gate_pass_freight_vouchers(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gate_pass_freight_voucher_events_idx
  ON public.gate_pass_freight_voucher_events (voucher_id, created_at);

ALTER TABLE public.gate_pass_settings
  ADD COLUMN IF NOT EXISTS freight_reminder_days integer NOT NULL DEFAULT 3
    CHECK (freight_reminder_days BETWEEN 1 AND 60);

-- 2. Roles -------------------------------------------------------------------

-- office → enter freight on a pass (the pass maker)
-- manage → transporters, corrections after out, cancel / re-issue
-- pay    → the cashier: mark paid, pay selected
-- read   → see freight, vouchers and transporters (never gate_security)
CREATE OR REPLACE FUNCTION public.gate_pass_freight_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'office' THEN ARRAY['super_admin','gate_pass_manager','gate_pass_officer']
    WHEN 'manage' THEN ARRAY['super_admin','gate_pass_manager']
    WHEN 'pay'    THEN ARRAY['super_admin','gate_pass_manager','pettycash_handler',
                             'accounting_poster','accounting_officer','accounting_manager']
    WHEN 'read'   THEN ARRAY['super_admin','gate_pass_manager','gate_pass_officer','gate_pass_viewer',
                             'gate_pass_sample_manager','gate_pass_returnable_manager',
                             'gate_pass_jobwork_manager','gate_pass_scrap_manager',
                             'pettycash_handler','accounting_poster','accounting_officer','accounting_manager',
                             'dispatch_operator','sales_order_manager','expenses_manager','expenses_officer','expenses_viewer']
    ELSE ARRAY[]::text[] END);
$$;

-- Read-only to clients, and only for the roles above (money is on these rows).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['gate_pass_transporters','gate_pass_freight','gate_pass_freight_vouchers',
                           'gate_pass_freight_statements','gate_pass_freight_voucher_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (public.gate_pass_freight_can(''read''));', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 3. View: the freight log -----------------------------------------------------
-- One row per sales pass that has freight recorded, with its live voucher.
-- security_invoker so the table policies above still apply.

DROP VIEW IF EXISTS public.v_gate_pass_freight_log;
CREATE VIEW public.v_gate_pass_freight_log
WITH (security_invoker = true) AS
SELECT g.id AS gate_pass_id, g.pass_number, g.pass_date, g.status AS pass_status, g.gate_out_at,
       (g.gate_out_at AT TIME ZONE 'Asia/Karachi')::date AS out_date,
       g.party_name, g.vehicle_number, g.driver_name, g.driver_contact, g.created_by AS pass_created_by,
       (SELECT string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number)
          FROM public.gate_pass_dispatches gd JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
         WHERE gd.gate_pass_id = g.id) AS dispatch_numbers,
       f.payer, f.mode, f.transporter_id, f.transporter_name, f.amount, f.booking_ref, f.note,
       v.id AS voucher_id, v.voucher_number, v.status AS voucher_status, v.voucher_date,
       v.paid_date, v.paid_amount, v.paid_by,
       v.statement_id, s.statement_number
  FROM public.gate_passes g
  JOIN public.gate_pass_freight f ON f.gate_pass_id = g.id
  LEFT JOIN public.gate_pass_freight_vouchers v ON v.gate_pass_id = g.id AND v.status <> 'cancelled'
  LEFT JOIN public.gate_pass_freight_statements s ON s.id = v.statement_id
 WHERE g.pass_type = 'sales';

GRANT SELECT ON public.v_gate_pass_freight_log TO anon, authenticated, service_role;

-- 4. Helpers ------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.gate_pass_freight_mode_label(p_mode text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT CASE p_mode WHEN 'contractor_van' THEN 'Contractor van' WHEN 'online_rickshaw' THEN 'Online rickshaw'
                        WHEN 'bike' THEN 'Bike' ELSE COALESCE(p_mode, '') END; $$;

CREATE OR REPLACE FUNCTION public.gate_pass_freight_voucher_log(
  p_voucher_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.gate_pass_freight_voucher_events (voucher_id, event, message, details, created_by)
  VALUES (p_voucher_id, p_event, p_message, p_details, public.app_user_id());
$$;

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

-- 5. Transporters ---------------------------------------------------------------
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

-- 6. Freight on a pass ----------------------------------------------------------
-- p_data: { payer* ('company'|'customer'|'customer_vehicle'),
--           mode, transporter_id | transporter_name (+ transporter_kind, transporter_phone),
--           amount, booking_ref, note, reason (after out) }
-- Before Out: the pass maker or a manager. After Out (managers, reason
-- required): corrects the live unpaid voucher, creates one if there is none
-- (a failed or cancelled one), or cancels it when the payer becomes the
-- customer. A paid voucher is never changed here: cancel it first.
CREATE OR REPLACE FUNCTION public.gate_pass_freight_save(p_pass_id uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  g public.gate_passes%ROWTYPE;
  f public.gate_pass_freight%ROWTYPE;
  v public.gate_pass_freight_vouchers%ROWTYPE;
  v_payer text := NULLIF(p_data->>'payer', '');
  v_mode text := NULLIF(p_data->>'mode', '');
  v_amount numeric := NULLIF(p_data->>'amount', '')::numeric;
  v_tid uuid := NULLIF(p_data->>'transporter_id', '')::uuid;
  v_tname text;
  v_reason text := NULLIF(btrim(p_data->>'reason'), '');
  v_before jsonb;
BEGIN
  SELECT * INTO g FROM public.gate_passes WHERE id = p_pass_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  IF g.pass_type <> 'sales' THEN
    RAISE EXCEPTION 'Freight is recorded on sales passes only.';
  END IF;
  IF g.status IN ('cancelled','rejected') THEN
    RAISE EXCEPTION 'Gate pass % is %.', g.pass_number, g.status;
  END IF;
  IF g.status = 'out' THEN
    IF NOT public.gate_pass_freight_can('manage') THEN
      RAISE EXCEPTION 'The vehicle has left: only a gate pass manager can change the freight now.';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'Give a reason for changing the freight after gate out.';
    END IF;
  ELSE
    IF NOT public.gate_pass_freight_can('office') THEN
      RAISE EXCEPTION 'You do not have permission to record freight.';
    END IF;
    IF g.created_by IS DISTINCT FROM v_uid AND NOT public.gate_pass_can('approve') THEN
      RAISE EXCEPTION 'Only the person who made this pass or a manager can change its freight.';
    END IF;
  END IF;

  IF v_payer IS NULL OR v_payer NOT IN ('company','customer','customer_vehicle') THEN
    RAISE EXCEPTION 'Say who pays the freight: the company, or the customer.';
  END IF;

  IF v_payer = 'company' THEN
    IF v_mode IS NULL OR v_mode NOT IN ('contractor_van','online_rickshaw','bike') THEN
      RAISE EXCEPTION 'Choose how the goods are going: contractor van, online rickshaw or bike.';
    END IF;
    IF v_amount IS NULL OR v_amount <= 0 THEN
      RAISE EXCEPTION 'Enter the freight amount.';
    END IF;
    v_tid := public.gate_pass_freight_transporter(v_tid, p_data->>'transporter_name', p_data->>'transporter_kind',
                                                  v_mode, p_data->>'transporter_phone');
    SELECT name INTO v_tname FROM public.gate_pass_transporters WHERE id = v_tid;
  ELSE
    v_mode := NULL; v_amount := NULL; v_tid := NULL; v_tname := NULL;
  END IF;

  SELECT * INTO f FROM public.gate_pass_freight WHERE gate_pass_id = p_pass_id;
  v_before := CASE WHEN FOUND THEN to_jsonb(f) END;

  INSERT INTO public.gate_pass_freight
    (gate_pass_id, payer, mode, transporter_id, transporter_name, amount, booking_ref, note, updated_by, updated_at)
  VALUES (p_pass_id, v_payer, v_mode, v_tid, v_tname, v_amount,
          NULLIF(btrim(p_data->>'booking_ref'), ''), NULLIF(btrim(p_data->>'note'), ''), v_uid, now())
  ON CONFLICT (gate_pass_id) DO UPDATE
    SET payer = EXCLUDED.payer, mode = EXCLUDED.mode, transporter_id = EXCLUDED.transporter_id,
        transporter_name = EXCLUDED.transporter_name, amount = EXCLUDED.amount,
        booking_ref = EXCLUDED.booking_ref, note = EXCLUDED.note, updated_by = v_uid, updated_at = now();

  PERFORM public.gate_pass_log(p_pass_id, 'freight_saved',
    CASE v_payer WHEN 'company' THEN 'Company pays · ' || public.gate_pass_freight_mode_label(v_mode) || ' · ' || v_tname
                 WHEN 'customer' THEN 'Freight paid by the customer'
                 ELSE 'Customer''s own vehicle' END
    || COALESCE(' — ' || v_reason, ''),
    jsonb_build_object('before', v_before));

  IF g.status <> 'out' THEN
    RETURN;
  END IF;

  -- After gate out: keep the live voucher in step with the freight.
  SELECT * INTO v FROM public.gate_pass_freight_vouchers WHERE gate_pass_id = p_pass_id AND status <> 'cancelled';
  IF FOUND AND v.status = 'paid' THEN
    RAISE EXCEPTION 'Voucher % is already paid. Cancel it first, then record the freight again.', v.voucher_number;
  END IF;

  IF v_payer <> 'company' THEN
    IF FOUND THEN
      UPDATE public.gate_pass_freight_vouchers
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = v_reason, updated_at = now()
       WHERE id = v.id;
      PERFORM public.gate_pass_freight_voucher_log(v.id, 'cancelled', 'Freight changed to customer paid: ' || v_reason);
      PERFORM public.gate_pass_log(p_pass_id, 'freight_voucher_cancelled', v.voucher_number || ': ' || v_reason);
    END IF;
    RETURN;
  END IF;

  IF NOT FOUND THEN
    PERFORM public.gate_pass_freight_voucher_create(g, COALESCE(g.gate_out_at, now()), v_reason);
    RETURN;
  END IF;

  UPDATE public.gate_pass_freight_vouchers
     SET mode = v_mode, transporter_id = v_tid, transporter_name = v_tname, amount = v_amount,
         booking_ref = NULLIF(btrim(p_data->>'booking_ref'), ''), note = NULLIF(btrim(p_data->>'note'), ''),
         driver_name = COALESCE(NULLIF(btrim(p_data->>'driver_name'), ''), driver_name),
         driver_contact = COALESCE(NULLIF(btrim(p_data->>'driver_contact'), ''), driver_contact),
         updated_at = now()
   WHERE id = v.id;
  PERFORM public.gate_pass_freight_voucher_log(v.id, 'corrected', v_reason,
    jsonb_build_object('before', jsonb_build_object('mode', v.mode, 'transporter_name', v.transporter_name,
      'amount', v.amount, 'booking_ref', v.booking_ref, 'note', v.note, 'driver_name', v.driver_name, 'driver_contact', v.driver_contact)));
  PERFORM public.gate_pass_log(p_pass_id, 'freight_voucher_corrected', v.voucher_number || ': ' || v_reason);
END;
$$;

-- A sales pass cannot go to the gate without the freight recorded.
CREATE OR REPLACE FUNCTION public.gate_pass_freight_check(p_pass_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.gate_pass_freight WHERE gate_pass_id = p_pass_id) THEN
    RAISE EXCEPTION 'Record the freight first: who pays, how the goods go and the amount.';
  END IF;
END;
$$;

-- 7. The voucher at gate out ----------------------------------------------------
-- Internal: called from gate_pass_mark_out (every Out path) and from
-- gate_pass_freight_save after out. Idempotent: one live voucher per pass.
CREATE OR REPLACE FUNCTION public.gate_pass_freight_voucher_create(g public.gate_passes, p_at timestamptz, p_reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  f public.gate_pass_freight%ROWTYPE;
  v_id uuid;
  v_num text;
  v_prev uuid;
  v_dcs text;
  v_customers text;
  v_msg text;
BEGIN
  IF g.pass_type <> 'sales' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO f FROM public.gate_pass_freight WHERE gate_pass_id = g.id;
  IF NOT FOUND THEN
    PERFORM public.gate_pass_log(g.id, 'freight_not_recorded', 'No freight was recorded on this pass');
    RETURN NULL;
  END IF;
  IF f.payer <> 'company' THEN
    PERFORM public.gate_pass_log(g.id, 'freight_customer',
      CASE f.payer WHEN 'customer' THEN 'Freight paid by the customer — no voucher' ELSE 'Customer''s own vehicle — no voucher' END);
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gate_pass_freight_vouchers WHERE gate_pass_id = g.id AND status <> 'cancelled') THEN
    RETURN NULL;
  END IF;

  SELECT id INTO v_prev FROM public.gate_pass_freight_vouchers
   WHERE gate_pass_id = g.id AND status = 'cancelled' ORDER BY created_at DESC LIMIT 1;

  SELECT string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number) INTO v_dcs
    FROM public.gate_pass_dispatches gd JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
   WHERE gd.gate_pass_id = g.id;
  SELECT string_agg(DISTINCT cu.name, '; ') INTO v_customers
    FROM public.gate_pass_dispatches gd
    JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
    JOIN public.sales_orders so
      ON so.id = sd.order_id
      OR so.id IN (SELECT o.order_id FROM public.sales_dispatch_orders o WHERE o.dispatch_id = sd.id)
    JOIN public.customers cu ON cu.id = so.customer_id
   WHERE gd.gate_pass_id = g.id;

  v_num := 'FV-' || lpad(nextval('public.gate_pass_freight_voucher_seq')::text, 6, '0');
  INSERT INTO public.gate_pass_freight_vouchers
    (voucher_number, gate_pass_id, voucher_date, mode, transporter_id, transporter_name,
     driver_name, driver_contact, vehicle_number, booking_ref, dispatch_numbers, customer_names,
     amount, note, replaces_voucher_id, created_by)
  VALUES (v_num, g.id, (p_at AT TIME ZONE 'Asia/Karachi')::date, f.mode, f.transporter_id, f.transporter_name,
          g.driver_name, g.driver_contact, COALESCE(g.gate_vehicle_number, g.vehicle_number), f.booking_ref,
          v_dcs, COALESCE(v_customers, g.party_name), f.amount, f.note, v_prev, v_uid)
  RETURNING id INTO v_id;

  v_msg := v_num || ' · Rs ' || to_char(f.amount, 'FM999,999,990') || ' · ' || f.transporter_name
           || ' · ' || public.gate_pass_freight_mode_label(f.mode) || ' · for ' || g.pass_number
           || COALESCE(' (' || v_dcs || ')', '');
  PERFORM public.gate_pass_freight_voucher_log(v_id, CASE WHEN v_prev IS NULL THEN 'created' ELSE 'reissued' END,
    COALESCE(p_reason, 'Made at gate out'));
  PERFORM public.gate_pass_log(g.id, 'freight_voucher', v_msg);

  -- Tell the cashiers (each role lands on the page it can open) and the pass maker.
  PERFORM public.notify_role(ARRAY['super_admin','gate_pass_manager']::app_role[],
    'Freight voucher to pay', v_msg, 'info', 'gate_pass', '/gate-pass/freight?voucher=' || v_id::text,
    'gate_pass_freight_voucher', v_id, v_uid, v_uid);
  PERFORM public.notify_role(ARRAY['accounting_poster','accounting_officer','accounting_manager']::app_role[],
    'Freight voucher to pay', v_msg, 'info', 'accounting', '/accounting/freight-vouchers?voucher=' || v_id::text,
    'gate_pass_freight_voucher', v_id, v_uid, v_uid);
  PERFORM public.notify_role(ARRAY['pettycash_handler']::app_role[],
    'Freight voucher to pay', v_msg, 'info', 'expenses', '/expenses/freight-vouchers?voucher=' || v_id::text,
    'gate_pass_freight_voucher', v_id, v_uid, v_uid);
  IF g.created_by IS NOT NULL AND g.created_by IS DISTINCT FROM v_uid
     AND NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = g.created_by
                      AND role::text IN ('super_admin','gate_pass_manager','accounting_poster','accounting_officer',
                                         'accounting_manager','pettycash_handler')) THEN
    PERFORM public.notify_user(g.created_by, 'Freight voucher made', v_msg, 'info', 'gate_pass',
      '/gate-pass/passes/' || g.id::text, 'gate_pass_freight_voucher', v_id, v_uid);
  END IF;
  RETURN v_id;
END;
$$;

-- 8. Paying -------------------------------------------------------------------
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

-- 9. Settings and the morning reminder -------------------------------------------

CREATE OR REPLACE FUNCTION public.gate_pass_freight_settings_save(p_reminder_days integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.gate_pass_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change gate pass settings.';
  END IF;
  UPDATE public.gate_pass_settings
     SET freight_reminder_days = p_reminder_days, updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- Daily: one note to the cashiers about vouchers unpaid for longer than the setting.
CREATE OR REPLACE FUNCTION public.gate_pass_freight_notify_unpaid()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_days integer;
  v_n integer;
  v_total numeric;
  v_msg text;
BEGIN
  SELECT freight_reminder_days INTO v_days FROM public.gate_pass_settings WHERE id;
  SELECT count(*), COALESCE(sum(amount), 0) INTO v_n, v_total
    FROM public.gate_pass_freight_vouchers
   WHERE status = 'unpaid'
     AND voucher_date < (now() AT TIME ZONE 'Asia/Karachi')::date - COALESCE(v_days, 3);
  IF v_n = 0 THEN
    RETURN 0;
  END IF;
  v_msg := v_n || ' freight voucher(s), Rs ' || to_char(v_total, 'FM999,999,990')
           || ', unpaid for more than ' || COALESCE(v_days, 3) || ' days';
  PERFORM public.notify_role(ARRAY['super_admin','gate_pass_manager']::app_role[],
    'Freight vouchers unpaid', v_msg, 'warning', 'gate_pass', '/gate-pass/freight', 'gate_pass_freight', NULL, NULL, NULL);
  PERFORM public.notify_role(ARRAY['accounting_poster','accounting_officer','accounting_manager']::app_role[],
    'Freight vouchers unpaid', v_msg, 'warning', 'accounting', '/accounting/freight-vouchers', 'gate_pass_freight', NULL, NULL, NULL);
  PERFORM public.notify_role(ARRAY['pettycash_handler']::app_role[],
    'Freight vouchers unpaid', v_msg, 'warning', 'expenses', '/expenses/freight-vouchers', 'gate_pass_freight', NULL, NULL, NULL);
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'gate-pass-freight-unpaid';
    -- 04:10 UTC = 09:10 in Pakistan, just after the overdue-returns note.
    PERFORM cron.schedule('gate-pass-freight-unpaid', '10 4 * * *', 'SELECT public.gate_pass_freight_notify_unpaid()');
  END IF;
END $$;

-- 10. gate_pass_mark_out: make the voucher when a sales pass goes Out -------------
-- Copy of 20261011120000_gate_out_delivers_dispatch.sql plus one line in the
-- sales branch.

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
    -- The freight voucher for the driver / contractor to collect cash against.
    PERFORM public.gate_pass_freight_voucher_create(g, p_at);
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

-- 11. gate_pass_submit: a sales pass needs its freight ----------------------------
-- Copy of 20261009120000_gate_pass_sample_no_self_approval.sql plus the check.

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
    PERFORM public.gate_pass_freight_check(p_id);
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

-- 12. gate_pass_save: the freight travels in p_data.freight ------------------------
-- Copy of 20260929120000_gate_pass_phase2_3.sql plus the freight block before
-- the backfill / submit step (a backfill goes straight to Out, so the freight
-- must be saved first).

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

-- 13. Permissions ---------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.gate_pass_freight_can(text),
  public.gate_pass_freight_mode_label(text),
  public.gate_pass_transporter_save(uuid, jsonb),
  public.gate_pass_freight_save(uuid, jsonb),
  public.gate_pass_freight_voucher_pay(uuid, jsonb),
  public.gate_pass_freight_pay_selected(uuid[], jsonb),
  public.gate_pass_freight_voucher_cancel(uuid, text),
  public.gate_pass_freight_settings_save(integer),
  public.gate_pass_save(uuid, jsonb, boolean),
  public.gate_pass_submit(uuid)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.gate_pass_freight_voucher_log(uuid, text, text, jsonb),
  public.gate_pass_freight_transporter(uuid, text, text, text, text),
  public.gate_pass_freight_check(uuid),
  public.gate_pass_freight_voucher_create(public.gate_passes, timestamptz, text),
  public.gate_pass_freight_notify_unpaid(),
  public.gate_pass_mark_out(uuid, timestamptz)
FROM PUBLIC, anon, authenticated;
