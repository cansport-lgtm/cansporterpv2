-- ============================================================================
-- Admin & Facilities — office equipment and tickets (EQT-…)
-- ----------------------------------------------------------------------------
-- Office equipment (ACs, generators, UPS, printers, water dispensers, CCTV,
-- fire extinguishers, lift, network) with its vendor / AMC contract and a
-- service interval, and the tickets raised against it. Kept SEPARATE from the
-- production Maintenance module (maintenance_work_orders stay for machines).
--
--   * Equipment types carry a default service interval (days or run hours)
--     and a checklist used on preventive tickets. Equipment may override the
--     interval. v_facilities_equipment_due computes the next due date / hours
--     and an AMC state against facilities_settings.amc_alert_days.
--   * A ticket is raised by ANY logged-in user (Self Service → Report a
--     Fault), by the camera daily check (facilities_ticket_from_camera), by a
--     cleaning action item, or as a preventive service ticket.
--     open → assigned → in_progress → done → closed (reopen allowed).
--   * Done records action taken, parts, cost and how it was paid; a
--     preventive ticket also stamps the equipment's last service date/hours.
--   * Daily alerts (pg_cron): AMC expiring / expired, service overdue,
--     high-priority tickets open longer than facilities_settings.ticket_escalation_days.
--
-- Tables are read-only to clients: every write goes through the SECURITY
-- DEFINER facilities_* functions below, which check the caller's role via
-- facilities_can() (20261110120100_facilities_core.sql). Every action is
-- logged in facilities_events (document_type 'ticket' / 'equipment').
-- Rollback: supabase/rollbacks/20261110120700_facilities_equipment_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.facilities_ticket_number_seq;

CREATE TABLE IF NOT EXISTS public.facilities_equipment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  service_interval_days integer CHECK (service_interval_days IS NULL OR service_interval_days > 0),
  service_interval_hours integer CHECK (service_interval_hours IS NULL OR service_interval_hours > 0),
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.facilities_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type_id uuid NOT NULL REFERENCES public.facilities_equipment_types(id) ON DELETE RESTRICT,
  location text,
  fixed_asset_id uuid REFERENCES public.fixed_assets(id) ON DELETE SET NULL,
  vendor_name text,
  amc_vendor_name text,
  amc_start date,
  amc_expiry date,
  service_interval_days integer CHECK (service_interval_days IS NULL OR service_interval_days > 0),
  service_interval_hours integer CHECK (service_interval_hours IS NULL OR service_interval_hours > 0),
  last_service_date date,
  run_hours numeric(12,1) NOT NULL DEFAULT 0 CHECK (run_hours >= 0),
  last_service_hours numeric(12,1) CHECK (last_service_hours IS NULL OR last_service_hours >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','out_of_service','retired')),
  remarks text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_equipment_type_idx ON public.facilities_equipment (type_id, status);

CREATE TABLE IF NOT EXISTS public.facilities_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text NOT NULL UNIQUE,
  equipment_id uuid REFERENCES public.facilities_equipment(id) ON DELETE SET NULL,
  -- FK to facilities_cameras added below when that table exists.
  camera_id uuid,
  location_text text,
  category text NOT NULL DEFAULT 'breakdown' CHECK (category IN ('breakdown','preventive','cctv','other')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','camera_check','action_item','service_due')),
  source_ref uuid,
  title text NOT NULL,
  description text,
  photo_path text,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','in_progress','done','closed')),
  reported_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  vendor_name text,
  assigned_at timestamptz,
  started_at timestamptz,
  done_at timestamptz,
  done_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  action_taken text,
  parts_used text,
  cost numeric(12,2) CHECK (cost IS NULL OR cost >= 0),
  paid_through text CHECK (paid_through IS NULL OR paid_through IN ('petty_cash','supplier_invoice','general_expense')),
  payment_ref text,
  run_hours_at_service numeric(12,1),
  closed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  reopened_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_tickets_status_idx ON public.facilities_tickets (status, priority, created_at DESC);
CREATE INDEX IF NOT EXISTS facilities_tickets_equipment_idx ON public.facilities_tickets (equipment_id, status);
CREATE INDEX IF NOT EXISTS facilities_tickets_camera_idx ON public.facilities_tickets (camera_id, status);
CREATE INDEX IF NOT EXISTS facilities_tickets_assigned_idx ON public.facilities_tickets (assigned_to, status);
CREATE INDEX IF NOT EXISTS facilities_tickets_reported_idx ON public.facilities_tickets (reported_by, created_at DESC);

DO $$
BEGIN
  IF to_regclass('public.facilities_cameras') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'facilities_tickets_camera_id_fkey') THEN
    ALTER TABLE public.facilities_tickets
      ADD CONSTRAINT facilities_tickets_camera_id_fkey
      FOREIGN KEY (camera_id) REFERENCES public.facilities_cameras(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.facilities_ticket_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.facilities_tickets(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_ticket_comments_ticket_idx ON public.facilities_ticket_comments (ticket_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_equipment_types','facilities_equipment',
                           'facilities_tickets','facilities_ticket_comments'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- Seed equipment types (idempotent).
INSERT INTO public.facilities_equipment_types (code, name, service_interval_days, service_interval_hours, checklist) VALUES
  ('AC', 'AC', 90, NULL, '["Filter wash","Coil clean","Gas pressure","Drain"]'),
  ('GENERATOR', 'Generator', NULL, 250, '["Oil & filter","Fuel filter","Battery","Load test"]'),
  ('UPS', 'UPS', 180, NULL, '["Battery test","Fan","Connections"]'),
  ('PRINTER', 'Printer', NULL, NULL, '[]'),
  ('WATER_DISPENSER', 'Water dispenser', 90, NULL, '["Tank clean","Filter"]'),
  ('CCTV', 'CCTV', NULL, NULL, '[]'),
  ('FIRE_EXT', 'Fire extinguisher', 365, NULL, '["Pressure gauge","Seal","Refill date","Mounting"]'),
  ('LIFT', 'Lift', 30, NULL, '["AMC visit"]'),
  ('NETWORK', 'Network/Server', NULL, NULL, '[]'),
  ('OTHER', 'Other', NULL, NULL, '[]')
ON CONFLICT (code) DO NOTHING;

-- 2. View: next service due and AMC state ---------------------------------------

CREATE OR REPLACE VIEW public.v_facilities_equipment_due AS
WITH s AS (SELECT amc_alert_days FROM public.facilities_settings WHERE id),
base AS (
  SELECT e.*,
         t.name AS type_name, t.code AS type_code, t.checklist AS type_checklist,
         COALESCE(e.service_interval_days, t.service_interval_days) AS interval_days,
         COALESCE(e.service_interval_hours, t.service_interval_hours) AS interval_hours
    FROM public.facilities_equipment e
    JOIN public.facilities_equipment_types t ON t.id = e.type_id
),
calc AS (
  SELECT b.*,
         CASE WHEN b.interval_days IS NOT NULL
              THEN COALESCE(b.last_service_date, b.created_at::date) + b.interval_days END AS next_due_date,
         CASE WHEN b.interval_hours IS NOT NULL
              THEN (COALESCE(b.last_service_hours, 0) + b.interval_hours) - b.run_hours END AS hours_to_service
    FROM base b
)
SELECT c.*,
       CASE
         WHEN c.status <> 'active' OR NOT c.is_active THEN 'none'
         WHEN c.next_due_date IS NULL AND c.hours_to_service IS NULL THEN 'none'
         WHEN (c.next_due_date IS NOT NULL AND c.next_due_date < public.facilities_today())
           OR (c.hours_to_service IS NOT NULL AND c.hours_to_service < 0) THEN 'overdue'
         WHEN (c.next_due_date IS NOT NULL AND c.next_due_date <= public.facilities_today() + 7)
           OR (c.hours_to_service IS NOT NULL AND c.hours_to_service <= 20) THEN 'due_soon'
         ELSE 'ok' END AS due_state,
       CASE
         WHEN c.amc_expiry IS NULL THEN 'none'
         WHEN c.amc_expiry < public.facilities_today() THEN 'expired'
         WHEN c.amc_expiry <= public.facilities_today() + (SELECT amc_alert_days FROM s) THEN 'expiring'
         ELSE 'ok' END AS amc_state
  FROM calc c;
GRANT SELECT ON public.v_facilities_equipment_due TO anon, authenticated, service_role;

-- 3. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_ticket_label(p_t public.facilities_tickets)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_t.ticket_number || ' · ' || p_t.title
      || CASE WHEN p_t.priority = 'high' THEN ' · HIGH' ELSE '' END;
$$;

-- The caller may work this ticket: the assignee, or anyone with operate rights.
CREATE OR REPLACE FUNCTION public.facilities_ticket_can_work(p_t public.facilities_tickets)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.facilities_can('operate')
      OR (p_t.assigned_to IS NOT NULL AND p_t.assigned_to = public.app_user_id()
          AND public.facilities_can('technician'));
$$;

-- 4. Masters -----------------------------------------------------------------

-- p_data: { code, name, service_interval_days, service_interval_hours, checklist: [..], is_active }
CREATE OR REPLACE FUNCTION public.facilities_equipment_type_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_code text := upper(NULLIF(btrim(p_data->>'code'), ''));
  v_name text := NULLIF(btrim(p_data->>'name'), '');
  v_days integer := NULLIF(p_data->>'service_interval_days', '')::integer;
  v_hours integer := NULLIF(p_data->>'service_interval_hours', '')::integer;
  v_checklist jsonb := COALESCE(p_data->'checklist', '[]'::jsonb);
  v_active boolean := COALESCE((p_data->>'is_active')::boolean, true);
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can edit equipment types.';
  END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Enter the type code.'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Enter the type name.'; END IF;
  IF jsonb_typeof(v_checklist) <> 'array' THEN RAISE EXCEPTION 'The checklist must be a list of points.'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO public.facilities_equipment_types (code, name, service_interval_days, service_interval_hours, checklist, is_active)
    VALUES (v_code, v_name, v_days, v_hours, v_checklist, v_active) RETURNING id INTO v_id;
  ELSE
    UPDATE public.facilities_equipment_types
       SET code = v_code, name = v_name, service_interval_days = v_days, service_interval_hours = v_hours,
           checklist = v_checklist, is_active = v_active, updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Equipment type not found.'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- p_data: { code, name, type_id, location, fixed_asset_id, vendor_name, amc_vendor_name,
--           amc_start, amc_expiry, service_interval_days, service_interval_hours,
--           last_service_date, run_hours, last_service_hours, status, remarks, is_active }
CREATE OR REPLACE FUNCTION public.facilities_equipment_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_code text := upper(NULLIF(btrim(p_data->>'code'), ''));
  v_name text := NULLIF(btrim(p_data->>'name'), '');
  v_type uuid := NULLIF(p_data->>'type_id', '')::uuid;
  v_asset uuid := NULLIF(p_data->>'fixed_asset_id', '')::uuid;
  v_amc_start date := NULLIF(p_data->>'amc_start', '')::date;
  v_amc_expiry date := NULLIF(p_data->>'amc_expiry', '')::date;
  v_status text := COALESCE(NULLIF(p_data->>'status', ''), 'active');
  v_run numeric := COALESCE(NULLIF(p_data->>'run_hours', '')::numeric, 0);
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can edit the equipment register.';
  END IF;
  IF v_code IS NULL THEN RAISE EXCEPTION 'Enter the equipment code.'; END IF;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Enter the equipment name.'; END IF;
  IF v_type IS NULL OR NOT EXISTS (SELECT 1 FROM public.facilities_equipment_types WHERE id = v_type) THEN
    RAISE EXCEPTION 'Choose the equipment type.';
  END IF;
  IF v_asset IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.fixed_assets WHERE id = v_asset) THEN
    RAISE EXCEPTION 'The fixed asset was not found.';
  END IF;
  IF v_amc_start IS NOT NULL AND v_amc_expiry IS NOT NULL AND v_amc_expiry < v_amc_start THEN
    RAISE EXCEPTION 'The AMC expiry cannot be before its start.';
  END IF;
  IF v_status NOT IN ('active','out_of_service','retired') THEN
    RAISE EXCEPTION 'Choose Active, Out of service or Retired.';
  END IF;
  IF v_run < 0 THEN RAISE EXCEPTION 'Run hours cannot be negative.'; END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.facilities_equipment
      (code, name, type_id, location, fixed_asset_id, vendor_name, amc_vendor_name, amc_start, amc_expiry,
       service_interval_days, service_interval_hours, last_service_date, run_hours, last_service_hours,
       status, remarks, is_active, created_by)
    VALUES
      (v_code, v_name, v_type, NULLIF(btrim(p_data->>'location'), ''), v_asset,
       NULLIF(btrim(p_data->>'vendor_name'), ''), NULLIF(btrim(p_data->>'amc_vendor_name'), ''),
       v_amc_start, v_amc_expiry,
       NULLIF(p_data->>'service_interval_days', '')::integer, NULLIF(p_data->>'service_interval_hours', '')::integer,
       NULLIF(p_data->>'last_service_date', '')::date, v_run, NULLIF(p_data->>'last_service_hours', '')::numeric,
       v_status, NULLIF(btrim(p_data->>'remarks'), ''), COALESCE((p_data->>'is_active')::boolean, true),
       public.app_user_id())
    RETURNING id INTO v_id;
    PERFORM public.facilities_log('equipment', v_id, 'created', v_code || ' ' || v_name);
  ELSE
    UPDATE public.facilities_equipment
       SET code = v_code, name = v_name, type_id = v_type,
           location = NULLIF(btrim(p_data->>'location'), ''), fixed_asset_id = v_asset,
           vendor_name = NULLIF(btrim(p_data->>'vendor_name'), ''),
           amc_vendor_name = NULLIF(btrim(p_data->>'amc_vendor_name'), ''),
           amc_start = v_amc_start, amc_expiry = v_amc_expiry,
           service_interval_days = NULLIF(p_data->>'service_interval_days', '')::integer,
           service_interval_hours = NULLIF(p_data->>'service_interval_hours', '')::integer,
           last_service_date = NULLIF(p_data->>'last_service_date', '')::date,
           run_hours = v_run, last_service_hours = NULLIF(p_data->>'last_service_hours', '')::numeric,
           status = v_status, remarks = NULLIF(btrim(p_data->>'remarks'), ''),
           is_active = COALESCE((p_data->>'is_active')::boolean, true), updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Equipment not found.'; END IF;
    PERFORM public.facilities_log('equipment', v_id, 'edited', v_code || ' ' || v_name);
  END IF;
  RETURN v_id;
END;
$$;

-- 5. Tickets -----------------------------------------------------------------

-- Any logged-in user may report. p_data:
--   { title, description, equipment_id, location_text, camera_id, priority,
--     photo_path, category, source, source_ref }
CREATE OR REPLACE FUNCTION public.facilities_ticket_create(p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_id uuid;
  v_title text := NULLIF(btrim(p_data->>'title'), '');
  v_equipment uuid := NULLIF(p_data->>'equipment_id', '')::uuid;
  v_camera uuid := NULLIF(p_data->>'camera_id', '')::uuid;
  v_location text := NULLIF(btrim(p_data->>'location_text'), '');
  v_priority text := COALESCE(NULLIF(p_data->>'priority', ''), 'medium');
  v_category text := COALESCE(NULLIF(p_data->>'category', ''), 'breakdown');
  v_source text := COALESCE(NULLIF(p_data->>'source', ''), 'manual');
  r public.facilities_tickets%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Log in again to report a fault.'; END IF;
  IF v_title IS NULL THEN RAISE EXCEPTION 'Write what is wrong (title).'; END IF;
  IF v_priority NOT IN ('low','medium','high') THEN RAISE EXCEPTION 'Choose a priority.'; END IF;
  IF v_category NOT IN ('breakdown','preventive','cctv','other') THEN RAISE EXCEPTION 'Choose a ticket category.'; END IF;
  IF v_source NOT IN ('manual','camera_check','action_item','service_due') THEN v_source := 'manual'; END IF;
  IF v_equipment IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.facilities_equipment WHERE id = v_equipment) THEN
    RAISE EXCEPTION 'Equipment not found.';
  END IF;
  IF v_equipment IS NULL AND v_camera IS NULL AND v_location IS NULL THEN
    RAISE EXCEPTION 'Choose the equipment or say where the fault is.';
  END IF;

  INSERT INTO public.facilities_tickets
    (ticket_number, equipment_id, camera_id, location_text, category, source, source_ref, title, description,
     photo_path, priority, reported_by)
  VALUES
    ('EQT-' || lpad(nextval('public.facilities_ticket_number_seq')::text, 6, '0'),
     v_equipment, v_camera, v_location, v_category, v_source, NULLIF(p_data->>'source_ref', '')::uuid,
     v_title, NULLIF(btrim(p_data->>'description'), ''), NULLIF(btrim(p_data->>'photo_path'), ''),
     v_priority, v_uid)
  RETURNING * INTO r;

  PERFORM public.facilities_log('ticket', r.id, 'created', 'Reported: ' || v_title,
    jsonb_build_object('source', v_source, 'priority', v_priority));
  PERFORM public.facilities_notify_managers('New equipment ticket', public.facilities_ticket_label(r),
    '/facilities/equipment/tickets/' || r.id::text, 'facilities_ticket', r.id,
    CASE WHEN v_priority = 'high' THEN 'warning' ELSE 'info' END, true);
  RETURN r.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_ticket_assign(p_id uuid, p_user uuid, p_vendor_name text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.facilities_tickets%ROWTYPE;
  v_vendor text := NULLIF(btrim(p_vendor_name), '');
  v_who text;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to assign tickets.';
  END IF;
  SELECT * INTO r FROM public.facilities_tickets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  IF r.status IN ('done','closed') THEN
    RAISE EXCEPTION 'Ticket % is % — reopen it first.', r.ticket_number, r.status;
  END IF;
  IF p_user IS NULL AND v_vendor IS NULL THEN
    RAISE EXCEPTION 'Choose a person or enter the vendor.';
  END IF;
  IF p_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = p_user AND is_active) THEN
    RAISE EXCEPTION 'That user is not active.';
  END IF;
  UPDATE public.facilities_tickets
     SET assigned_to = p_user, vendor_name = v_vendor, assigned_at = now(),
         status = CASE WHEN status = 'in_progress' THEN 'in_progress' ELSE 'assigned' END, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  v_who := COALESCE((SELECT full_name FROM public.app_users WHERE id = p_user), v_vendor);
  PERFORM public.facilities_log('ticket', p_id, 'assigned', 'Assigned to ' || v_who);
  PERFORM public.facilities_notify_user(p_user, 'Ticket assigned to you', public.facilities_ticket_label(r),
    '/facilities/equipment/tickets/' || p_id::text, 'facilities_ticket', p_id,
    CASE WHEN r.priority = 'high' THEN 'warning' ELSE 'info' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_ticket_start(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.facilities_tickets%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.facilities_tickets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  IF NOT public.facilities_ticket_can_work(r) THEN
    RAISE EXCEPTION 'Only the person this ticket is assigned to, or an admin officer, can start it.';
  END IF;
  IF r.status NOT IN ('open','assigned') THEN
    RAISE EXCEPTION 'Ticket % is already %.', r.ticket_number, replace(r.status, '_', ' ');
  END IF;
  UPDATE public.facilities_tickets
     SET status = 'in_progress', started_at = COALESCE(started_at, now()),
         assigned_to = COALESCE(assigned_to, public.app_user_id()), updated_at = now()
   WHERE id = p_id;
  PERFORM public.facilities_log('ticket', p_id, 'started', 'Work started');
END;
$$;

-- p_data: { action_taken, parts_used, cost, paid_through, payment_ref, run_hours_at_service }
CREATE OR REPLACE FUNCTION public.facilities_ticket_done(p_id uuid, p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.facilities_tickets%ROWTYPE;
  v_action text := NULLIF(btrim(p_data->>'action_taken'), '');
  v_cost numeric := NULLIF(p_data->>'cost', '')::numeric;
  v_paid text := NULLIF(p_data->>'paid_through', '');
  v_hours numeric := NULLIF(p_data->>'run_hours_at_service', '')::numeric;
BEGIN
  SELECT * INTO r FROM public.facilities_tickets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  IF NOT public.facilities_ticket_can_work(r) THEN
    RAISE EXCEPTION 'Only the person this ticket is assigned to, or an admin officer, can mark it done.';
  END IF;
  IF r.status NOT IN ('open','assigned','in_progress') THEN
    RAISE EXCEPTION 'Ticket % is already %.', r.ticket_number, r.status;
  END IF;
  IF v_action IS NULL THEN RAISE EXCEPTION 'Write the action taken.'; END IF;
  IF v_cost IS NOT NULL AND v_cost < 0 THEN RAISE EXCEPTION 'The cost cannot be negative.'; END IF;
  IF v_cost IS NOT NULL AND v_cost > 0 AND v_paid IS NULL THEN
    RAISE EXCEPTION 'Say how the cost was paid (petty cash, supplier invoice or general expense).';
  END IF;
  IF v_paid IS NOT NULL AND v_paid NOT IN ('petty_cash','supplier_invoice','general_expense') THEN
    RAISE EXCEPTION 'Choose how the cost was paid.';
  END IF;

  UPDATE public.facilities_tickets
     SET status = 'done', done_at = now(), done_by = public.app_user_id(),
         action_taken = v_action, parts_used = NULLIF(btrim(p_data->>'parts_used'), ''),
         cost = v_cost, paid_through = v_paid, payment_ref = NULLIF(btrim(p_data->>'payment_ref'), ''),
         run_hours_at_service = v_hours, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;

  IF r.equipment_id IS NOT NULL THEN
    IF r.category = 'preventive' THEN
      UPDATE public.facilities_equipment
         SET last_service_date = public.facilities_today(),
             run_hours = GREATEST(run_hours, COALESCE(v_hours, run_hours)),
             last_service_hours = COALESCE(v_hours, run_hours), updated_at = now()
       WHERE id = r.equipment_id;
    ELSIF v_hours IS NOT NULL THEN
      UPDATE public.facilities_equipment SET run_hours = GREATEST(run_hours, v_hours), updated_at = now()
       WHERE id = r.equipment_id;
    END IF;
  END IF;

  PERFORM public.facilities_log('ticket', p_id, 'done', v_action,
    jsonb_build_object('cost', v_cost, 'paid_through', v_paid));
  PERFORM public.facilities_notify_managers('Ticket done', public.facilities_ticket_label(r) || ' — ' || v_action,
    '/facilities/equipment/tickets/' || p_id::text, 'facilities_ticket', p_id, 'success', false);
  PERFORM public.facilities_notify_user(r.reported_by, 'Your fault report is resolved', public.facilities_ticket_label(r),
    '/facilities/equipment/tickets/' || p_id::text, 'facilities_ticket', p_id, 'success');
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_ticket_close(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r public.facilities_tickets%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('manage') THEN
    RAISE EXCEPTION 'Only a facilities manager can close tickets.';
  END IF;
  SELECT * INTO r FROM public.facilities_tickets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  IF r.status <> 'done' THEN
    RAISE EXCEPTION 'Ticket % must be marked done before it is closed.', r.ticket_number;
  END IF;
  UPDATE public.facilities_tickets
     SET status = 'closed', closed_by = public.app_user_id(), closed_at = now(), updated_at = now()
   WHERE id = p_id;
  PERFORM public.facilities_log('ticket', p_id, 'closed', 'Closed');
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_ticket_reopen(p_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.facilities_tickets%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to reopen tickets.';
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'Give the reason for reopening.'; END IF;
  SELECT * INTO r FROM public.facilities_tickets WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  IF r.status NOT IN ('done','closed') THEN
    RAISE EXCEPTION 'Ticket % is still open.', r.ticket_number;
  END IF;
  UPDATE public.facilities_tickets
     SET status = CASE WHEN assigned_to IS NULL AND vendor_name IS NULL THEN 'open' ELSE 'assigned' END,
         done_at = NULL, done_by = NULL, closed_at = NULL, closed_by = NULL,
         reopened_count = reopened_count + 1, updated_at = now()
   WHERE id = p_id RETURNING * INTO r;
  PERFORM public.facilities_log('ticket', p_id, 'reopened', v_reason);
  PERFORM public.facilities_notify_user(r.assigned_to, 'Ticket reopened', public.facilities_ticket_label(r) || ': ' || v_reason,
    '/facilities/equipment/tickets/' || p_id::text, 'facilities_ticket', p_id, 'warning');
END;
$$;

CREATE OR REPLACE FUNCTION public.facilities_ticket_comment(p_id uuid, p_body text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  r public.facilities_tickets%ROWTYPE;
  v_body text := NULLIF(btrim(p_body), '');
  v_cid uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Log in again to comment.'; END IF;
  IF v_body IS NULL THEN RAISE EXCEPTION 'Write the comment.'; END IF;
  SELECT * INTO r FROM public.facilities_tickets WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ticket not found.'; END IF;
  IF NOT (r.reported_by = v_uid OR r.assigned_to = v_uid OR public.facilities_can('technician')) THEN
    RAISE EXCEPTION 'Only the reporter, the assignee or the admin team can comment on this ticket.';
  END IF;
  INSERT INTO public.facilities_ticket_comments (ticket_id, body, created_by)
  VALUES (p_id, v_body, v_uid) RETURNING id INTO v_cid;
  UPDATE public.facilities_tickets SET updated_at = now() WHERE id = p_id;
  PERFORM public.facilities_log('ticket', p_id, 'comment', v_body);
  -- Tell the other side.
  IF r.assigned_to IS NOT NULL AND r.assigned_to <> v_uid THEN
    PERFORM public.facilities_notify_user(r.assigned_to, 'Comment on ' || r.ticket_number, v_body,
      '/facilities/equipment/tickets/' || p_id::text, 'facilities_ticket', p_id, 'info');
  END IF;
  IF r.reported_by IS NOT NULL AND r.reported_by <> v_uid THEN
    PERFORM public.facilities_notify_user(r.reported_by, 'Comment on ' || r.ticket_number, v_body,
      '/facilities/equipment/tickets/' || p_id::text, 'facilities_ticket', p_id, 'info');
  END IF;
  RETURN v_cid;
END;
$$;

-- Called by the camera daily check for every camera whose result is not ok:
-- re-opens the camera's existing open ticket (as a comment) or raises a new one.
CREATE OR REPLACE FUNCTION public.facilities_ticket_from_camera(
  p_camera_id uuid, p_check_id uuid, p_result text, p_remark text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_code text;
  v_name text;
  v_zone text;
  v_label text;
  v_existing uuid;
  v_id uuid;
  v_body text;
BEGIN
  IF to_regclass('public.facilities_cameras') IS NULL THEN RETURN NULL; END IF;
  EXECUTE 'SELECT code, name, zone FROM public.facilities_cameras WHERE id = $1'
    INTO v_code, v_name, v_zone USING p_camera_id;
  IF v_code IS NULL THEN RETURN NULL; END IF;

  v_label := CASE p_result
    WHEN 'blurry' THEN 'Blurry picture'
    WHEN 'offline' THEN 'Offline'
    WHEN 'damaged' THEN 'Damaged'
    WHEN 'no_recording' THEN 'Not recording'
    WHEN 'wrong_angle' THEN 'Wrong angle'
    ELSE initcap(replace(COALESCE(p_result, 'fault'), '_', ' ')) END;
  v_body := 'Daily camera check: ' || v_label || COALESCE(' — ' || NULLIF(btrim(p_remark), ''), '');

  SELECT id INTO v_existing FROM public.facilities_tickets
   WHERE camera_id = p_camera_id AND status IN ('open','assigned','in_progress')
   ORDER BY created_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    INSERT INTO public.facilities_ticket_comments (ticket_id, body, created_by)
    VALUES (v_existing, v_body, v_uid);
    UPDATE public.facilities_tickets SET updated_at = now() WHERE id = v_existing;
    PERFORM public.facilities_log('ticket', v_existing, 'comment', v_body,
      jsonb_build_object('check_id', p_check_id));
    RETURN v_existing;
  END IF;

  -- A done-but-not-closed ticket is reopened rather than duplicated.
  SELECT id INTO v_existing FROM public.facilities_tickets
   WHERE camera_id = p_camera_id AND status = 'done'
   ORDER BY done_at DESC LIMIT 1;
  IF v_existing IS NOT NULL THEN
    UPDATE public.facilities_tickets
       SET status = CASE WHEN assigned_to IS NULL AND vendor_name IS NULL THEN 'open' ELSE 'assigned' END,
           done_at = NULL, done_by = NULL, reopened_count = reopened_count + 1, updated_at = now()
     WHERE id = v_existing;
    INSERT INTO public.facilities_ticket_comments (ticket_id, body, created_by)
    VALUES (v_existing, v_body, v_uid);
    PERFORM public.facilities_log('ticket', v_existing, 'reopened', v_body,
      jsonb_build_object('check_id', p_check_id));
    PERFORM public.facilities_notify_managers('Camera fault again', v_code || ' ' || v_name || ': ' || v_label,
      '/facilities/equipment/tickets/' || v_existing::text, 'facilities_ticket', v_existing, 'warning', true);
    RETURN v_existing;
  END IF;

  v_id := public.facilities_ticket_create(jsonb_build_object(
    'title', v_code || ' ' || v_name || ': ' || v_label,
    'description', v_body,
    'camera_id', p_camera_id,
    'location_text', v_zone,
    'category', 'cctv',
    'source', 'camera_check',
    'source_ref', p_check_id,
    'priority', 'medium'));
  RETURN v_id;
END;
$$;

-- A preventive service ticket for one piece of equipment, with its type's checklist.
CREATE OR REPLACE FUNCTION public.facilities_service_ticket_create(p_equipment_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  e record;
  v_desc text;
  v_existing uuid;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to create service tickets.';
  END IF;
  SELECT eq.id, eq.code, eq.name, eq.location, t.name AS type_name, t.checklist
    INTO e FROM public.facilities_equipment eq JOIN public.facilities_equipment_types t ON t.id = eq.type_id
   WHERE eq.id = p_equipment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Equipment not found.'; END IF;
  SELECT id INTO v_existing FROM public.facilities_tickets
   WHERE equipment_id = p_equipment_id AND category = 'preventive' AND status IN ('open','assigned','in_progress')
   LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'A service ticket for % % is already open.', e.code, e.name;
  END IF;
  SELECT COALESCE(string_agg('• ' || x, E'\n'), '') INTO v_desc
    FROM jsonb_array_elements_text(COALESCE(e.checklist, '[]'::jsonb)) AS x;
  v_desc := 'Periodic service (' || e.type_name || ')' || CASE WHEN v_desc <> '' THEN E'\n' || v_desc ELSE '' END;
  RETURN public.facilities_ticket_create(jsonb_build_object(
    'title', 'Service: ' || e.code || ' ' || e.name,
    'description', v_desc,
    'equipment_id', p_equipment_id,
    'location_text', e.location,
    'category', 'preventive',
    'source', 'service_due',
    'priority', 'low'));
END;
$$;

-- 6. Daily alerts (pg_cron) ----------------------------------------------------

CREATE OR REPLACE FUNCTION public.facilities_equipment_daily_alerts()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_n integer := 0;
  v_cnt integer;
  v_names text;
  v_days integer;
  v_roles app_role[] := ARRAY['super_admin','facilities_manager']::app_role[];
BEGIN
  SELECT ticket_escalation_days INTO v_days FROM public.facilities_settings WHERE id;

  -- (a) AMC expiring / expired
  SELECT count(*), string_agg(code || ' ' || name || ' (' || to_char(amc_expiry, 'DD Mon') || ')', ', ' ORDER BY amc_expiry)
    INTO v_cnt, v_names
    FROM public.v_facilities_equipment_due
   WHERE amc_state IN ('expiring','expired') AND status = 'active' AND is_active;
  IF v_cnt > 0 THEN
    PERFORM public.notify_role(v_roles, 'AMC expiring: ' || v_cnt || ' contract(s)', left(v_names, 500), 'warning',
      'facilities', '/facilities/equipment', 'facilities_equipment', NULL, NULL, NULL);
    v_n := v_n + 1;
  END IF;

  -- (b) Service overdue
  SELECT count(*), string_agg(code || ' ' || name, ', ' ORDER BY next_due_date NULLS LAST)
    INTO v_cnt, v_names
    FROM public.v_facilities_equipment_due
   WHERE due_state = 'overdue';
  IF v_cnt > 0 THEN
    PERFORM public.notify_role(v_roles, 'Service overdue: ' || v_cnt || ' equipment', left(v_names, 500), 'warning',
      'facilities', '/facilities/equipment', 'facilities_equipment', NULL, NULL, NULL);
    v_n := v_n + 1;
  END IF;

  -- (c) High-priority tickets open too long
  SELECT count(*), string_agg(ticket_number || ' ' || title, ', ' ORDER BY created_at)
    INTO v_cnt, v_names
    FROM public.facilities_tickets
   WHERE priority = 'high' AND status IN ('open','assigned','in_progress')
     AND created_at < now() - make_interval(days => v_days);
  IF v_cnt > 0 THEN
    PERFORM public.notify_role(v_roles, 'High-priority tickets open > ' || v_days || ' days: ' || v_cnt, left(v_names, 500),
      'error', 'facilities', '/facilities/equipment/tickets', 'facilities_ticket', NULL, NULL, NULL);
    v_n := v_n + 1;
  END IF;
  RETURN v_n;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facilities-equipment-alerts';
    -- 03:30 UTC = 08:30 in Pakistan.
    PERFORM cron.schedule('facilities-equipment-alerts', '30 3 * * *', 'SELECT public.facilities_equipment_daily_alerts()');
  END IF;
END $$;

-- 7. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_ticket_label(public.facilities_tickets),
  public.facilities_ticket_can_work(public.facilities_tickets),
  public.facilities_equipment_type_save(uuid, jsonb),
  public.facilities_equipment_save(uuid, jsonb),
  public.facilities_ticket_create(jsonb),
  public.facilities_ticket_assign(uuid, uuid, text),
  public.facilities_ticket_start(uuid),
  public.facilities_ticket_done(uuid, jsonb),
  public.facilities_ticket_close(uuid),
  public.facilities_ticket_reopen(uuid, text),
  public.facilities_ticket_comment(uuid, text),
  public.facilities_ticket_from_camera(uuid, uuid, text, text),
  public.facilities_service_ticket_create(uuid),
  public.facilities_equipment_daily_alerts()
  TO anon, authenticated, service_role;
