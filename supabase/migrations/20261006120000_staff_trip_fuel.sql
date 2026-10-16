-- ============================================================================
-- Staff Trip Fuel: fuel claim and cash voucher for an official duty gate pass
-- ----------------------------------------------------------------------------
-- A staff member who went out on company work (an official_duty staff gate
-- pass, scanned Out and In) claims the fuel for that trip: route / areas
-- travelled and either the bike's start and end odometer or a manual
-- kilometre figure, with an optional odometer photo. The claim becomes a
-- numbered Trip Fuel Voucher (TFV-000001 …) for km × a flat rate per km from
-- the settings. The rate and the figures are frozen on the voucher.
--
-- Flow:
--   staff member (self-service) or HR claims → pending_approval
--     → HR manager approves → approved   (the voucher is printed; the staff
--                                          member collects cash from the cashier)
--     → cashier marks paid → paid
--   rejected (HR manager) / cancelled (the claimant or HR manager, before paid)
--
-- One voucher per pass (cancelled / rejected ones free the pass again). Claims
-- are possible only on an official_duty pass that was scanned Out (returned,
-- or not scanned in at day end). Nothing is written to Petty Cash or to the
-- accounting books: the voucher is the document, cash is managed by hand.
--
-- Roles (staff_trip_fuel_can):
--   claim    HR (staff_gate_pass_can('apply')) or the staff member on the pass
--   approve  super_admin, hr_manager
--   pay      super_admin, pettycash_handler, expenses_manager, expenses_officer
--   settings super_admin
--
-- Rollback: supabase/rollbacks/20261006120000_staff_trip_fuel_down.sql
-- ============================================================================

-- 1. Settings and storage -----------------------------------------------------

ALTER TABLE public.staff_gate_pass_settings
  ADD COLUMN IF NOT EXISTS fuel_rate_per_km numeric(10,2) NOT NULL DEFAULT 0 CHECK (fuel_rate_per_km >= 0),
  ADD COLUMN IF NOT EXISTS fuel_max_km_per_trip integer NOT NULL DEFAULT 300 CHECK (fuel_max_km_per_trip BETWEEN 1 AND 5000);

INSERT INTO storage.buckets (id, name, public)
VALUES ('trip-odometer-photos', 'trip-odometer-photos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Trip odometer photos are publicly accessible" ON storage.objects;
CREATE POLICY "Trip odometer photos are publicly accessible"
ON storage.objects FOR SELECT USING (bucket_id = 'trip-odometer-photos');

DROP POLICY IF EXISTS "Anyone can upload trip odometer photos" ON storage.objects;
CREATE POLICY "Anyone can upload trip odometer photos"
ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'trip-odometer-photos');

-- 2. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.staff_trip_fuel_number_seq;

CREATE TABLE IF NOT EXISTS public.staff_trip_fuel_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number text NOT NULL UNIQUE
    DEFAULT 'TFV-' || lpad(nextval('public.staff_trip_fuel_number_seq')::text, 6, '0'),
  pass_id uuid NOT NULL REFERENCES public.staff_gate_passes(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
  trip_date date NOT NULL,
  destination text,
  purpose text,
  route text,
  start_km numeric(10,1),
  end_km numeric(10,1),
  manual_km numeric(10,1),
  km numeric(10,1) NOT NULL CHECK (km > 0),
  rate_per_km numeric(10,2) NOT NULL CHECK (rate_per_km >= 0),
  amount numeric(12,2) NOT NULL CHECK (amount >= 0),
  odometer_photo_url text,
  notes text,
  status text NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN ('pending_approval','approved','paid','rejected','cancelled')),
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approval_remarks text,
  paid_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  paid_at timestamptz,
  paid_remarks text,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text
);
CREATE INDEX IF NOT EXISTS staff_trip_fuel_vouchers_date_idx ON public.staff_trip_fuel_vouchers (trip_date DESC, status);
CREATE INDEX IF NOT EXISTS staff_trip_fuel_vouchers_employee_idx ON public.staff_trip_fuel_vouchers (employee_id, trip_date DESC);
CREATE INDEX IF NOT EXISTS staff_trip_fuel_vouchers_status_idx ON public.staff_trip_fuel_vouchers (status) WHERE status IN ('pending_approval','approved');
-- One live voucher per pass.
CREATE UNIQUE INDEX IF NOT EXISTS staff_trip_fuel_vouchers_pass_uidx
  ON public.staff_trip_fuel_vouchers (pass_id)
  WHERE status IN ('pending_approval','approved','paid');

CREATE TABLE IF NOT EXISTS public.staff_trip_fuel_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.staff_trip_fuel_vouchers(id) ON DELETE CASCADE,
  event text NOT NULL,
  message text,
  details jsonb,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS staff_trip_fuel_events_voucher_idx ON public.staff_trip_fuel_events (voucher_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_trip_fuel_vouchers','staff_trip_fuel_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS audit_row_change ON public.staff_trip_fuel_vouchers;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_trip_fuel_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('hr');

-- 3. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'approve'  THEN ARRAY['super_admin','hr_manager']
    WHEN 'pay'      THEN ARRAY['super_admin','pettycash_handler','expenses_manager','expenses_officer']
    WHEN 'settings' THEN ARRAY['super_admin']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_log(
  p_id uuid, p_event text, p_message text DEFAULT NULL, p_details jsonb DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  INSERT INTO public.staff_trip_fuel_events (voucher_id, event, message, details, created_by)
  VALUES (p_id, p_event, p_message, p_details, public.app_user_id());
$$;

-- "TFV-000012 (EMP-041 Ali Khan, 24 km, Rs 480)"
CREATE OR REPLACE FUNCTION public.staff_trip_fuel_label(p_v public.staff_trip_fuel_vouchers)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_v.voucher_number || ' (' || e.employee_code || ' ' || e.full_name || ', '
         || trim(to_char(p_v.km, 'FM9999990.#')) || ' km, Rs ' || trim(to_char(p_v.amount, 'FM999999990')) || ')'
    FROM public.employees e WHERE e.id = p_v.employee_id;
$$;

-- Notify the claimant, the HR managers and / or the cashiers; never the actor.
-- The claimant's link opens on My Gate Passes when they raised it themselves.
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
    PERFORM public.notify_role(ARRAY['super_admin','hr_manager']::app_role[], p_title, p_message, p_type,
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

-- 4. Claim ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_claim(
  p_pass_id uuid, p_route text,
  p_start_km numeric DEFAULT NULL, p_end_km numeric DEFAULT NULL, p_manual_km numeric DEFAULT NULL,
  p_photo_url text DEFAULT NULL, p_notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.staff_gate_passes%ROWTYPE;
  s public.staff_gate_pass_settings%ROWTYPE;
  v public.staff_trip_fuel_vouchers%ROWTYPE;
  v_self boolean;
  v_km numeric;
  v_other text;
BEGIN
  SELECT * INTO g FROM public.staff_gate_passes WHERE id = p_pass_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gate pass not found.';
  END IF;
  v_self := public.staff_gate_pass_is_self(g.employee_id);
  IF NOT (public.staff_gate_pass_can('apply') OR v_self) THEN
    RAISE EXCEPTION 'Only the staff member on the pass or HR can claim trip fuel.';
  END IF;
  IF g.pass_kind <> 'official_duty' THEN
    RAISE EXCEPTION 'Trip fuel can be claimed on an Official duty pass only.';
  END IF;
  IF g.status NOT IN ('returned','not_returned') OR g.gate_out_at IS NULL THEN
    RAISE EXCEPTION 'Trip fuel can be claimed once the pass has been scanned Out and the trip is over (pass % is %).', g.pass_number, replace(g.status, '_', ' ');
  END IF;
  SELECT voucher_number || ' (' || replace(status, '_', ' ') || ')' INTO v_other
    FROM public.staff_trip_fuel_vouchers
   WHERE pass_id = p_pass_id AND status IN ('pending_approval','approved','paid') LIMIT 1;
  IF v_other IS NOT NULL THEN
    RAISE EXCEPTION 'Pass % already has fuel voucher %.', g.pass_number, v_other;
  END IF;
  IF NULLIF(btrim(p_route), '') IS NULL THEN
    RAISE EXCEPTION 'Give the route / areas travelled.';
  END IF;

  SELECT * INTO s FROM public.staff_gate_pass_settings WHERE id;
  IF COALESCE(s.fuel_rate_per_km, 0) <= 0 THEN
    RAISE EXCEPTION 'The fuel rate per km is not set. A super admin sets it on the Trip Fuel Vouchers page.';
  END IF;

  IF p_start_km IS NOT NULL OR p_end_km IS NOT NULL THEN
    IF p_start_km IS NULL OR p_end_km IS NULL THEN
      RAISE EXCEPTION 'Give both the start and the end odometer reading, or the kilometres run.';
    END IF;
    IF p_end_km <= p_start_km THEN
      RAISE EXCEPTION 'The end odometer reading must be greater than the start reading.';
    END IF;
    v_km := p_end_km - p_start_km;
  ELSE
    v_km := p_manual_km;
  END IF;
  IF v_km IS NULL OR v_km <= 0 THEN
    RAISE EXCEPTION 'Give the kilometres run for the trip.';
  END IF;
  IF v_km > s.fuel_max_km_per_trip THEN
    RAISE EXCEPTION 'A single trip cannot exceed % km. Check the readings or ask HR.', s.fuel_max_km_per_trip;
  END IF;
  v_km := round(v_km, 1);

  INSERT INTO public.staff_trip_fuel_vouchers
    (pass_id, employee_id, trip_date, destination, purpose, route, start_km, end_km, manual_km, km,
     rate_per_km, amount, odometer_photo_url, notes, created_by)
  VALUES
    (g.id, g.employee_id, g.pass_date, g.destination, g.reason, btrim(p_route),
     CASE WHEN p_start_km IS NOT NULL THEN round(p_start_km, 1) END,
     CASE WHEN p_end_km IS NOT NULL THEN round(p_end_km, 1) END,
     CASE WHEN p_start_km IS NULL THEN round(p_manual_km, 1) END,
     v_km, s.fuel_rate_per_km, round(v_km * s.fuel_rate_per_km, 0),
     NULLIF(btrim(p_photo_url), ''), NULLIF(btrim(p_notes), ''), public.app_user_id())
  RETURNING * INTO v;

  PERFORM public.staff_trip_fuel_log(v.id, 'claimed',
    'Claimed ' || trim(to_char(v.km, 'FM9999990.#')) || ' km × Rs ' || trim(to_char(v.rate_per_km, 'FM999990.##'))
    || ' = Rs ' || trim(to_char(v.amount, 'FM999999990')) || ' for ' || g.pass_number
    || CASE WHEN v.start_km IS NOT NULL THEN ' (odometer ' || trim(to_char(v.start_km, 'FM9999999990.#')) || ' → ' || trim(to_char(v.end_km, 'FM9999999990.#')) || ')'
            ELSE ' (kilometres entered by hand)' END
    || CASE WHEN v_self THEN ', raised by the staff member' ELSE '' END,
    jsonb_build_object('km', v.km, 'rate', v.rate_per_km, 'amount', v.amount, 'self', v_self));
  PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel claim needs approval',
    public.staff_trip_fuel_label(v) || ' for ' || g.pass_number || COALESCE(' to ' || g.destination, '') || ' on '
      || to_char(g.pass_date, 'DD Mon') || ': ' || btrim(p_route),
    'info', false, true, false);
  RETURN v.id;
END;
$$;

-- 5. Approve / reject (HR manager) --------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_review(p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.staff_trip_fuel_vouchers%ROWTYPE;
  v_status text := CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
BEGIN
  IF NOT public.staff_trip_fuel_can('approve') THEN
    RAISE EXCEPTION 'Only an HR manager can approve or reject a trip fuel claim.';
  END IF;
  SELECT * INTO v FROM public.staff_trip_fuel_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel voucher not found.';
  END IF;
  IF v.status <> 'pending_approval' THEN
    RAISE EXCEPTION 'Fuel voucher % is not waiting for approval.', v.voucher_number;
  END IF;
  IF NOT p_approve AND NULLIF(btrim(p_remarks), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting the claim.';
  END IF;

  UPDATE public.staff_trip_fuel_vouchers
     SET status = v_status, approved_by = public.app_user_id(), approved_at = now(),
         approval_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v;
  PERFORM public.staff_trip_fuel_log(p_id, v_status, NULLIF(btrim(p_remarks), ''));
  IF p_approve THEN
    PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel voucher approved — collect from the cashier',
      public.staff_trip_fuel_label(v) || ' is approved. Show the voucher to the cashier.' || COALESCE(' ' || NULLIF(btrim(p_remarks), ''), ''),
      'success', true, false, true);
  ELSE
    PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel claim rejected',
      public.staff_trip_fuel_label(v) || ': ' || btrim(p_remarks), 'warning', true, false, false);
  END IF;
  RETURN v_status;
END;
$$;

-- 6. Pay (cashier) -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_pay(p_id uuid, p_remarks text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v public.staff_trip_fuel_vouchers%ROWTYPE;
BEGIN
  IF NOT public.staff_trip_fuel_can('pay') THEN
    RAISE EXCEPTION 'Only the cashier (petty cash handler / expenses) can mark a fuel voucher paid.';
  END IF;
  SELECT * INTO v FROM public.staff_trip_fuel_vouchers WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fuel voucher not found.';
  END IF;
  IF v.status <> 'approved' THEN
    RAISE EXCEPTION 'Fuel voucher % is % — only an approved voucher can be paid.', v.voucher_number, replace(v.status, '_', ' ');
  END IF;

  UPDATE public.staff_trip_fuel_vouchers
     SET status = 'paid', paid_by = public.app_user_id(), paid_at = now(),
         paid_remarks = NULLIF(btrim(p_remarks), ''), updated_at = now()
   WHERE id = p_id
  RETURNING * INTO v;
  PERFORM public.staff_trip_fuel_log(p_id, 'paid', 'Cash paid' || COALESCE(': ' || NULLIF(btrim(p_remarks), ''), ''));
  PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel paid',
    public.staff_trip_fuel_label(v) || ' was paid in cash.', 'success', true, false, false);
END;
$$;

-- 7. Cancel (claimant or HR manager, before paid) ------------------------------------

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
  IF NOT (public.staff_trip_fuel_can('approve') OR v.created_by = v_uid) THEN
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

-- 8. Settings --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_settings_save(p_rate_per_km numeric, p_max_km_per_trip integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.staff_trip_fuel_can('settings') THEN
    RAISE EXCEPTION 'Only a super admin can change the trip fuel settings.';
  END IF;
  UPDATE public.staff_gate_pass_settings
     SET fuel_rate_per_km = COALESCE(p_rate_per_km, fuel_rate_per_km),
         fuel_max_km_per_trip = COALESCE(p_max_km_per_trip, fuel_max_km_per_trip),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 9. Grants ------------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.staff_trip_fuel_can(text),
  public.staff_trip_fuel_claim(uuid, text, numeric, numeric, numeric, text, text),
  public.staff_trip_fuel_review(uuid, boolean, text),
  public.staff_trip_fuel_pay(uuid, text),
  public.staff_trip_fuel_cancel(uuid, text),
  public.staff_trip_fuel_settings_save(numeric, integer)
  TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public.staff_trip_fuel_log(uuid, text, text, jsonb),
  public.staff_trip_fuel_label(public.staff_trip_fuel_vouchers),
  public.staff_trip_fuel_notify(public.staff_trip_fuel_vouchers, text, text, text, boolean, boolean, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.staff_trip_fuel_log(uuid, text, text, jsonb),
  public.staff_trip_fuel_label(public.staff_trip_fuel_vouchers),
  public.staff_trip_fuel_notify(public.staff_trip_fuel_vouchers, text, text, text, boolean, boolean, boolean)
  TO service_role;
