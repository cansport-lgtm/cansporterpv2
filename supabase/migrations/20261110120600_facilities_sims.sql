-- ============================================================================
-- Admin & Facilities — Employee SIM management
-- ----------------------------------------------------------------------------
-- The company's SIM cards: who holds which number, the package and its
-- monthly limit, and the monthly bill per network.
--
--   * Register: facilities_sims. One SIM has one holder at a time. Status
--     in_stock → issued → (return) in_stock; suspended / lost / closed set by
--     the admin (lost / closed also clear the holder).
--   * Movements: facilities_sim_movements (SIM-000001, …) record every issue,
--     return and status change.
--   * Bills: one bill run per network per month (facilities_sim_bills) with one
--     line per issued / suspended SIM (facilities_sim_bill_lines). Posting
--     computes each line's over-limit part (amount − monthly limit, never
--     below 0). THE COMPANY BEARS THE BILL: there is no salary deduction. The
--     over-limit lines are only flagged, may carry a note, and are reported to
--     the facilities manager (v_facilities_sim_over_limit, last 6 months).
--   * Reminder: facilities_sim_bill_reminder() (pg_cron, daily) tells the
--     managers and officers on facilities_settings.sim_bill_due_day when a
--     network with issued SIMs has no posted bill for the previous month.
--
-- Who (facilities_can):
--   manage   facilities_manager, super admin: add / edit SIMs, PUK & ICCID,
--            notes on posted bills, reopen a posted bill
--   operate  + facilities_officer: issue / return / status, bill runs
--
-- Tables are read-only to clients: every write goes through the SECURITY
-- DEFINER facilities_sim_* functions below. Every action is logged in
-- facilities_events (document_type 'sim' or 'sim_bill').
-- Core helpers: 20261110120100_facilities_core.sql.
-- Rollback: supabase/rollbacks/20261110120600_facilities_sims_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.facilities_sim_movement_number_seq;

CREATE TABLE IF NOT EXISTS public.facilities_sims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sim_number text NOT NULL UNIQUE CHECK (sim_number ~ '^[0-9][0-9-]{5,24}$'),
  network text NOT NULL CHECK (network IN ('Jazz','Zong','Telenor','Ufone','Other')),
  package_name text,
  package_cost numeric(12,2) NOT NULL DEFAULT 0 CHECK (package_cost >= 0),
  monthly_limit numeric(12,2) NOT NULL DEFAULT 0 CHECK (monthly_limit >= 0),
  sim_type text NOT NULL DEFAULT 'voice' CHECK (sim_type IN ('voice','data','device')),
  status text NOT NULL DEFAULT 'in_stock' CHECK (status IN ('in_stock','issued','suspended','lost','closed')),
  holder_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  handset_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
  -- Shown only to facilities managers (the page hides them for everyone else).
  iccid text,
  puk text,
  remarks text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facilities_sims_holder_status CHECK (
    (status = 'issued' AND holder_employee_id IS NOT NULL)
    OR (status = 'suspended')
    OR (status IN ('in_stock','lost','closed') AND holder_employee_id IS NULL))
);
CREATE INDEX IF NOT EXISTS facilities_sims_holder_idx ON public.facilities_sims (holder_employee_id);
CREATE INDEX IF NOT EXISTS facilities_sims_network_status_idx ON public.facilities_sims (network, status);

CREATE TABLE IF NOT EXISTS public.facilities_sim_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_number text NOT NULL UNIQUE
    DEFAULT 'SIM-' || lpad(nextval('public.facilities_sim_movement_number_seq')::text, 6, '0'),
  sim_id uuid NOT NULL REFERENCES public.facilities_sims(id) ON DELETE CASCADE,
  movement_type text NOT NULL CHECK (movement_type IN ('issue','return','status')),
  from_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  to_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  movement_date date NOT NULL DEFAULT public.facilities_today(),
  new_status text NOT NULL CHECK (new_status IN ('in_stock','issued','suspended','lost','closed')),
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_sim_movements_sim_idx ON public.facilities_sim_movements (sim_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.facilities_sim_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  network text NOT NULL CHECK (network IN ('Jazz','Zong','Telenor','Ufone','Other')),
  -- First day of the billed month.
  bill_month date NOT NULL CHECK (bill_month = date_trunc('month', bill_month)::date),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted')),
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  over_limit_total numeric(14,2) NOT NULL DEFAULT 0,
  over_limit_count integer NOT NULL DEFAULT 0,
  posted_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  posted_at timestamptz,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (network, bill_month)
);

CREATE TABLE IF NOT EXISTS public.facilities_sim_bill_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id uuid NOT NULL REFERENCES public.facilities_sim_bills(id) ON DELETE CASCADE,
  sim_id uuid NOT NULL REFERENCES public.facilities_sims(id) ON DELETE CASCADE,
  -- Holder when the bill was started (snapshot).
  holder_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  monthly_limit numeric(12,2) NOT NULL DEFAULT 0,
  over_limit numeric(12,2) NOT NULL DEFAULT 0,
  note text,
  UNIQUE (bill_id, sim_id)
);
CREATE INDEX IF NOT EXISTS facilities_sim_bill_lines_sim_idx ON public.facilities_sim_bill_lines (sim_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_sims','facilities_sim_movements',
                           'facilities_sim_bills','facilities_sim_bill_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Views -------------------------------------------------------------------

-- Over-limit lines of posted bills in the last 6 months, one row per SIM.
CREATE OR REPLACE VIEW public.v_facilities_sim_over_limit AS
  SELECT s.id AS sim_id,
         s.sim_number,
         s.network,
         e.full_name AS holder_name,
         e.employee_code AS holder_code,
         count(*)::integer AS months_over,
         sum(l.over_limit)::numeric(14,2) AS total_over,
         max(b.bill_month) AS last_month_over
    FROM public.facilities_sim_bill_lines l
    JOIN public.facilities_sim_bills b ON b.id = l.bill_id AND b.status = 'posted'
    JOIN public.facilities_sims s ON s.id = l.sim_id
    LEFT JOIN public.employees e ON e.id = s.holder_employee_id
   WHERE l.over_limit > 0
     AND b.bill_month >= (date_trunc('month', public.facilities_today()) - interval '5 months')::date
   GROUP BY s.id, s.sim_number, s.network, e.full_name, e.employee_code;
GRANT SELECT ON public.v_facilities_sim_over_limit TO anon, authenticated, service_role;

-- 3. Register ----------------------------------------------------------------

-- Add or edit a SIM (manage). p_data: { sim_number, network, package_name,
-- package_cost, monthly_limit, sim_type, handset_asset_id, iccid, puk,
-- remarks, is_active }. Status and holder change only through
-- facilities_sim_move.
CREATE OR REPLACE FUNCTION public.facilities_sim_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_id uuid := p_id;
  v_number text := regexp_replace(COALESCE(p_data->>'sim_number', ''), '[^0-9-]', '', 'g');
  v_network text := NULLIF(btrim(p_data->>'network'), '');
  v_package text := NULLIF(btrim(p_data->>'package_name'), '');
  v_cost numeric := COALESCE(NULLIF(p_data->>'package_cost', '')::numeric, 0);
  v_limit numeric := COALESCE(NULLIF(p_data->>'monthly_limit', '')::numeric, 0);
  v_type text := COALESCE(NULLIF(p_data->>'sim_type', ''), 'voice');
  v_handset uuid := NULLIF(p_data->>'handset_asset_id', '')::uuid;
  v_active boolean := COALESCE((p_data->>'is_active')::boolean, true);
  v_old public.facilities_sims%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can add or edit SIMs.';
  END IF;
  IF v_number !~ '^[0-9][0-9-]{5,24}$' THEN
    RAISE EXCEPTION 'Enter the SIM number (digits, dashes allowed), e.g. 0300-1234567.';
  END IF;
  IF v_network IS NULL OR v_network NOT IN ('Jazz','Zong','Telenor','Ufone','Other') THEN
    RAISE EXCEPTION 'Choose the network.';
  END IF;
  IF v_cost < 0 OR v_limit < 0 THEN
    RAISE EXCEPTION 'Package cost and monthly limit cannot be negative.';
  END IF;
  IF v_type NOT IN ('voice','data','device') THEN
    RAISE EXCEPTION 'Choose Voice, Data or Device.';
  END IF;
  IF v_handset IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id = v_handset) THEN
    RAISE EXCEPTION 'The handset is not in the fixed asset register.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities_sims WHERE sim_number = v_number AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'SIM % is already in the register.', v_number;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.facilities_sims (sim_number, network, package_name, package_cost, monthly_limit, sim_type,
                                        handset_asset_id, iccid, puk, remarks, is_active, created_by)
    VALUES (v_number, v_network, v_package, v_cost, v_limit, v_type, v_handset,
            NULLIF(btrim(p_data->>'iccid'), ''), NULLIF(btrim(p_data->>'puk'), ''),
            NULLIF(btrim(p_data->>'remarks'), ''), v_active, v_uid)
    RETURNING id INTO v_id;
    PERFORM public.facilities_log('sim', v_id, 'created', 'SIM ' || v_number || ' added (' || v_network || ')');
  ELSE
    SELECT * INTO v_old FROM public.facilities_sims WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SIM not found.';
    END IF;
    IF NOT v_active AND v_old.status = 'issued' THEN
      RAISE EXCEPTION 'SIM % is with % — take it back before making it inactive.', v_old.sim_number,
        COALESCE((SELECT full_name FROM public.employees WHERE id = v_old.holder_employee_id), 'an employee');
    END IF;
    UPDATE public.facilities_sims SET
      sim_number = v_number, network = v_network, package_name = v_package, package_cost = v_cost,
      monthly_limit = v_limit, sim_type = v_type, handset_asset_id = v_handset,
      iccid = CASE WHEN p_data ? 'iccid' THEN NULLIF(btrim(p_data->>'iccid'), '') ELSE iccid END,
      puk = CASE WHEN p_data ? 'puk' THEN NULLIF(btrim(p_data->>'puk'), '') ELSE puk END,
      remarks = NULLIF(btrim(p_data->>'remarks'), ''), is_active = v_active, updated_at = now()
    WHERE id = v_id;
    PERFORM public.facilities_log('sim', v_id, 'edited', 'SIM ' || v_number || ' edited',
      jsonb_build_object('package_cost', v_cost, 'monthly_limit', v_limit, 'is_active', v_active));
  END IF;
  RETURN v_id;
END;
$$;

-- Issue, return or change the status of a SIM (operate). p_data:
--   { sim_id, movement_type: issue | return | status, to_employee_id,
--     movement_date, new_status (for 'status': suspended | lost | closed |
--     in_stock), remarks }
-- Returns the movement id.
CREATE OR REPLACE FUNCTION public.facilities_sim_move(p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_sim public.facilities_sims%ROWTYPE;
  v_type text := NULLIF(p_data->>'movement_type', '');
  v_to uuid := NULLIF(p_data->>'to_employee_id', '')::uuid;
  v_date date := COALESCE(NULLIF(p_data->>'movement_date', '')::date, public.facilities_today());
  v_new_status text := NULLIF(p_data->>'new_status', '');
  v_remarks text := NULLIF(btrim(p_data->>'remarks'), '');
  v_from uuid;
  v_holder_name text;
  v_app_user uuid;
  v_mid uuid;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to issue or take back SIMs.';
  END IF;
  SELECT * INTO v_sim FROM public.facilities_sims WHERE id = NULLIF(p_data->>'sim_id', '')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SIM not found.';
  END IF;
  IF v_date > public.facilities_today() THEN
    RAISE EXCEPTION 'The date cannot be in the future.';
  END IF;
  v_from := v_sim.holder_employee_id;

  IF v_type = 'issue' THEN
    IF NOT v_sim.is_active THEN
      RAISE EXCEPTION 'SIM % is inactive.', v_sim.sim_number;
    END IF;
    IF v_sim.status <> 'in_stock' THEN
      RAISE EXCEPTION 'SIM % is % and cannot be issued.', v_sim.sim_number, replace(v_sim.status, '_', ' ');
    END IF;
    IF v_to IS NULL OR NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_to AND is_active) THEN
      RAISE EXCEPTION 'Choose an active employee.';
    END IF;
    v_new_status := 'issued';
    UPDATE public.facilities_sims SET status = 'issued', holder_employee_id = v_to, updated_at = now() WHERE id = v_sim.id;
  ELSIF v_type = 'return' THEN
    IF v_sim.status NOT IN ('issued','suspended') OR v_sim.holder_employee_id IS NULL THEN
      RAISE EXCEPTION 'SIM % is not with anyone.', v_sim.sim_number;
    END IF;
    v_to := NULL;
    v_new_status := 'in_stock';
    UPDATE public.facilities_sims SET status = 'in_stock', holder_employee_id = NULL, updated_at = now() WHERE id = v_sim.id;
  ELSIF v_type = 'status' THEN
    IF v_new_status IS NULL OR v_new_status NOT IN ('suspended','lost','closed','in_stock') THEN
      RAISE EXCEPTION 'Choose the new status: suspended, lost, closed or in stock.';
    END IF;
    IF v_new_status = v_sim.status THEN
      RAISE EXCEPTION 'SIM % is already %.', v_sim.sim_number, replace(v_new_status, '_', ' ');
    END IF;
    IF v_new_status = 'suspended' AND v_sim.status NOT IN ('issued','in_stock') THEN
      RAISE EXCEPTION 'Only an issued or in-stock SIM can be suspended.';
    END IF;
    IF v_new_status = 'in_stock' THEN
      -- Back from suspended (no holder) / lost / closed to usable stock.
      IF v_sim.status = 'suspended' AND v_sim.holder_employee_id IS NOT NULL THEN
        -- Reactivated while still with its holder: it is issued again.
        v_new_status := 'issued';
        v_to := v_sim.holder_employee_id;
      END IF;
    END IF;
    IF v_remarks IS NULL AND v_new_status IN ('lost','closed') THEN
      RAISE EXCEPTION 'Write why the SIM is %.', v_new_status;
    END IF;
    IF v_new_status IN ('lost','closed','in_stock') THEN
      v_to := NULL;
      UPDATE public.facilities_sims SET status = v_new_status, holder_employee_id = NULL, updated_at = now() WHERE id = v_sim.id;
    ELSE
      -- suspended (holder kept) or issued (reactivated with holder)
      v_to := v_sim.holder_employee_id;
      UPDATE public.facilities_sims SET status = v_new_status, updated_at = now() WHERE id = v_sim.id;
    END IF;
  ELSE
    RAISE EXCEPTION 'Choose Issue, Return or Status change.';
  END IF;

  INSERT INTO public.facilities_sim_movements (sim_id, movement_type, from_employee_id, to_employee_id,
                                               movement_date, new_status, remarks, created_by)
  VALUES (v_sim.id, v_type, v_from, v_to, v_date, v_new_status, v_remarks, v_uid)
  RETURNING id INTO v_mid;

  SELECT full_name INTO v_holder_name FROM public.employees WHERE id = COALESCE(v_to, v_from);
  PERFORM public.facilities_log('sim', v_sim.id, v_type,
    CASE v_type
      WHEN 'issue'  THEN 'SIM ' || v_sim.sim_number || ' issued to ' || COALESCE(v_holder_name, '?')
      WHEN 'return' THEN 'SIM ' || v_sim.sim_number || ' returned by ' || COALESCE(v_holder_name, '?')
      ELSE 'SIM ' || v_sim.sim_number || ' marked ' || replace(v_new_status, '_', ' ') END
    || COALESCE(' — ' || v_remarks, ''),
    jsonb_build_object('movement_id', v_mid, 'from', v_from, 'to', v_to, 'new_status', v_new_status));

  IF v_type = 'issue' THEN
    SELECT app_user_id INTO v_app_user FROM public.employees WHERE id = v_to;
    PERFORM public.facilities_notify_user(v_app_user, 'SIM issued to you',
      'SIM ' || v_sim.sim_number || ' (' || v_sim.network
      || COALESCE(', ' || v_sim.package_name, '') || ') · monthly limit PKR ' || v_sim.monthly_limit::text,
      '/my-assets', 'facilities_sim', v_sim.id, 'info');
  END IF;
  RETURN v_mid;
END;
$$;

-- 4. Bills -------------------------------------------------------------------

-- Start (or reopen the draft of) the bill run of one network for one month.
-- One line per SIM of the network that is issued or suspended, amount =
-- package cost. Returns the bill id.
CREATE OR REPLACE FUNCTION public.facilities_sim_bill_start(p_network text, p_month date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_month date := date_trunc('month', p_month)::date;
  v_id uuid;
  v_status text;
  v_n integer;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to enter SIM bills.';
  END IF;
  IF p_network IS NULL OR p_network NOT IN ('Jazz','Zong','Telenor','Ufone','Other') THEN
    RAISE EXCEPTION 'Choose the network.';
  END IF;
  IF p_month IS NULL OR v_month > date_trunc('month', public.facilities_today())::date THEN
    RAISE EXCEPTION 'Choose this month or an earlier one.';
  END IF;

  SELECT id, status INTO v_id, v_status FROM public.facilities_sim_bills
   WHERE network = p_network AND bill_month = v_month;
  IF v_id IS NOT NULL THEN
    IF v_status = 'posted' THEN
      RETURN v_id;
    END IF;
    -- Draft: add SIMs issued since it was started, keep entered amounts.
    INSERT INTO public.facilities_sim_bill_lines (bill_id, sim_id, holder_employee_id, amount, monthly_limit)
    SELECT v_id, s.id, s.holder_employee_id, s.package_cost, s.monthly_limit
      FROM public.facilities_sims s
     WHERE s.network = p_network AND s.is_active AND s.status IN ('issued','suspended')
       AND NOT EXISTS (SELECT 1 FROM public.facilities_sim_bill_lines l WHERE l.bill_id = v_id AND l.sim_id = s.id);
    RETURN v_id;
  END IF;

  INSERT INTO public.facilities_sim_bills (network, bill_month, created_by)
  VALUES (p_network, v_month, v_uid) RETURNING id INTO v_id;
  INSERT INTO public.facilities_sim_bill_lines (bill_id, sim_id, holder_employee_id, amount, monthly_limit)
  SELECT v_id, s.id, s.holder_employee_id, s.package_cost, s.monthly_limit
    FROM public.facilities_sims s
   WHERE s.network = p_network AND s.is_active AND s.status IN ('issued','suspended');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    DELETE FROM public.facilities_sim_bills WHERE id = v_id;
    RAISE EXCEPTION 'No issued % SIM — nothing to bill.', p_network;
  END IF;
  UPDATE public.facilities_sim_bills b SET total_amount = (SELECT COALESCE(sum(amount), 0) FROM public.facilities_sim_bill_lines WHERE bill_id = b.id)
   WHERE id = v_id;
  PERFORM public.facilities_log('sim_bill', v_id, 'started',
    p_network || ' bill for ' || to_char(v_month, 'Mon YYYY') || ' started (' || v_n || ' numbers)');
  RETURN v_id;
END;
$$;

-- Save the amounts of a draft bill. p_lines: [{ id, amount }].
CREATE OR REPLACE FUNCTION public.facilities_sim_bill_save_lines(p_id uuid, p_lines jsonb)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bill public.facilities_sim_bills%ROWTYPE;
  x jsonb;
  v_amount numeric;
  v_total numeric;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to enter SIM bills.';
  END IF;
  SELECT * INTO v_bill FROM public.facilities_sim_bills WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'This bill is posted. A facilities manager can reopen it.';
  END IF;
  FOR x IN SELECT * FROM jsonb_array_elements(COALESCE(p_lines, '[]'::jsonb)) LOOP
    v_amount := NULLIF(x->>'amount', '')::numeric;
    IF v_amount IS NULL OR v_amount < 0 THEN
      RAISE EXCEPTION 'Enter an amount of 0 or more for every number.';
    END IF;
    UPDATE public.facilities_sim_bill_lines SET amount = round(v_amount, 2)
     WHERE id = NULLIF(x->>'id', '')::uuid AND bill_id = p_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'A line does not belong to this bill.';
    END IF;
  END LOOP;
  SELECT COALESCE(sum(amount), 0) INTO v_total FROM public.facilities_sim_bill_lines WHERE bill_id = p_id;
  UPDATE public.facilities_sim_bills SET total_amount = v_total, updated_at = now() WHERE id = p_id;
  RETURN v_total;
END;
$$;

-- Post a bill: over-limit per line = greatest(amount − limit, 0); totals;
-- managers are told how many numbers went over and by how much.
CREATE OR REPLACE FUNCTION public.facilities_sim_bill_post(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_bill public.facilities_sim_bills%ROWTYPE;
  v_total numeric;
  v_over numeric;
  v_count integer;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to post SIM bills.';
  END IF;
  SELECT * INTO v_bill FROM public.facilities_sim_bills WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;
  IF v_bill.status <> 'draft' THEN
    RAISE EXCEPTION 'This bill is already posted.';
  END IF;
  UPDATE public.facilities_sim_bill_lines SET over_limit = greatest(amount - monthly_limit, 0) WHERE bill_id = p_id;
  SELECT COALESCE(sum(amount), 0), COALESCE(sum(over_limit), 0), count(*) FILTER (WHERE over_limit > 0)
    INTO v_total, v_over, v_count FROM public.facilities_sim_bill_lines WHERE bill_id = p_id;
  UPDATE public.facilities_sim_bills SET
    status = 'posted', total_amount = v_total, over_limit_total = v_over, over_limit_count = v_count,
    posted_by = v_uid, posted_at = now(), updated_at = now()
  WHERE id = p_id;
  PERFORM public.facilities_log('sim_bill', p_id, 'posted',
    v_bill.network || ' bill for ' || to_char(v_bill.bill_month, 'Mon YYYY') || ' posted: PKR ' || v_total::text
    || ', ' || v_count || ' over limit (PKR ' || v_over::text || ', borne by the company)',
    jsonb_build_object('total_amount', v_total, 'over_limit_total', v_over, 'over_limit_count', v_count));
  PERFORM public.facilities_notify_managers(
    'SIM bill posted · ' || v_bill.network || ' ' || to_char(v_bill.bill_month, 'Mon YYYY'),
    'Total PKR ' || to_char(v_total, 'FM999,999,999') || '. ' || v_count || ' number(s) over limit by PKR '
    || to_char(v_over, 'FM999,999,999') || ' (company bears).',
    '/facilities/sims/bills', 'facilities_sim_bill', p_id,
    CASE WHEN v_count > 0 THEN 'warning' ELSE 'info' END, false);
END;
$$;

-- A note on an over-limit line of a posted bill (manage).
CREATE OR REPLACE FUNCTION public.facilities_sim_bill_note(p_line_id uuid, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_bill_id uuid; v_sim text;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can note a bill line.';
  END IF;
  UPDATE public.facilities_sim_bill_lines l SET note = NULLIF(btrim(p_note), '')
   WHERE l.id = p_line_id
  RETURNING l.bill_id, (SELECT sim_number FROM public.facilities_sims WHERE id = l.sim_id) INTO v_bill_id, v_sim;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill line not found.';
  END IF;
  PERFORM public.facilities_log('sim_bill', v_bill_id, 'noted', 'Note on ' || v_sim || ': ' || COALESCE(NULLIF(btrim(p_note), ''), '(cleared)'));
END;
$$;

-- Reopen a posted bill to correct amounts (manage).
CREATE OR REPLACE FUNCTION public.facilities_sim_bill_reopen(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_bill public.facilities_sim_bills%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can reopen a posted bill.';
  END IF;
  SELECT * INTO v_bill FROM public.facilities_sim_bills WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill not found.';
  END IF;
  IF v_bill.status <> 'posted' THEN
    RAISE EXCEPTION 'This bill is not posted.';
  END IF;
  UPDATE public.facilities_sim_bills SET
    status = 'draft', over_limit_total = 0, over_limit_count = 0, posted_by = NULL, posted_at = NULL, updated_at = now()
  WHERE id = p_id;
  UPDATE public.facilities_sim_bill_lines SET over_limit = 0 WHERE bill_id = p_id;
  PERFORM public.facilities_log('sim_bill', p_id, 'reopened',
    v_bill.network || ' bill for ' || to_char(v_bill.bill_month, 'Mon YYYY') || ' reopened');
END;
$$;

-- 5. Reminder (pg_cron, daily) -----------------------------------------------

-- On facilities_settings.sim_bill_due_day: every network with issued SIMs
-- whose previous-month bill is not posted is listed once to managers and
-- officers.
CREATE OR REPLACE FUNCTION public.facilities_sim_bill_reminder()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := public.facilities_today();
  v_due integer;
  v_prev date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_missing text;
BEGIN
  SELECT sim_bill_due_day INTO v_due FROM public.facilities_settings WHERE id;
  IF extract(day FROM v_today)::integer <> COALESCE(v_due, 10) THEN
    RETURN 0;
  END IF;
  SELECT string_agg(n.network, ', ' ORDER BY n.network) INTO v_missing
    FROM (SELECT DISTINCT s.network FROM public.facilities_sims s
           WHERE s.is_active AND s.status IN ('issued','suspended')) n
   WHERE NOT EXISTS (SELECT 1 FROM public.facilities_sim_bills b
                      WHERE b.network = n.network AND b.bill_month = v_prev AND b.status = 'posted');
  IF v_missing IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM public.notify_role(ARRAY['super_admin','facilities_manager','facilities_officer']::app_role[],
    'SIM bill for ' || to_char(v_prev, 'Mon YYYY') || ' not entered',
    'No posted bill yet for: ' || v_missing || '. Enter it on Admin & Facilities → SIM Register & Bills.',
    'warning', 'facilities', '/facilities/sims/bills', 'facilities_sim_bill', NULL, NULL, NULL);
  RETURN 1;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-sim-bill-reminder';
    -- 04:30 UTC = 09:30 in Pakistan.
    PERFORM cron.schedule('facilities-sim-bill-reminder', '30 4 * * *', 'SELECT public.facilities_sim_bill_reminder()');
  END IF;
END $$;

-- 6. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_sim_save(uuid, jsonb),
  public.facilities_sim_move(jsonb),
  public.facilities_sim_bill_start(text, date),
  public.facilities_sim_bill_save_lines(uuid, jsonb),
  public.facilities_sim_bill_post(uuid),
  public.facilities_sim_bill_note(uuid, text),
  public.facilities_sim_bill_reopen(uuid),
  public.facilities_sim_bill_reminder()
  TO anon, authenticated, service_role;
