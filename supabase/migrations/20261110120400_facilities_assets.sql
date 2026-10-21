-- ============================================================================
-- Admin & Facilities — office asset custody (AST-…)
-- ----------------------------------------------------------------------------
-- Who holds which office asset. The asset itself stays in the Fixed Asset
-- register (fixed_assets, category office_assets): issuing it never changes
-- its value, status or disposal. This module only records movements:
--
--   issue     admin store → employee
--   return    employee → admin store
--   transfer  employee → employee
--   verify    physical verification: the holder is unchanged, the condition
--             and "last verified" are refreshed (QR scan or by hand)
--
-- v_facilities_asset_custody is one row per live office asset with its
-- current holder, condition and last verification, derived from the latest
-- movements. The receiving employee acknowledges an issue / transfer on
-- /my-assets (or the admin ticks "signed on paper").
--
-- Who:
--   move / mark on paper   facilities_can('operate'): super_admin,
--                          facilities_manager, facilities_officer
--   acknowledge            the employee whose record is linked to the login
--
-- Tables are read-only to clients: every write goes through the SECURITY
-- DEFINER facilities_asset_* functions below. Every action is logged in
-- facilities_events (document_type 'asset_movement').
-- Core helpers: 20261110120100_facilities_core.sql.
-- Rollback: supabase/rollbacks/20261110120400_facilities_assets_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE SEQUENCE IF NOT EXISTS public.facilities_asset_movement_seq;

CREATE TABLE IF NOT EXISTS public.facilities_asset_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_number text NOT NULL UNIQUE,
  fixed_asset_id uuid NOT NULL REFERENCES public.fixed_assets(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('issue','return','transfer','verify')),
  from_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  to_employee_id uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  movement_date date NOT NULL DEFAULT public.facilities_today(),
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('new','good','fair','damaged')),
  accessories text,
  remarks text,
  ack_status text NOT NULL DEFAULT 'pending' CHECK (ack_status IN ('pending','acknowledged','on_paper')),
  acknowledged_at timestamptz,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS facilities_asset_movements_asset_idx
  ON public.facilities_asset_movements (fixed_asset_id, created_at DESC);
CREATE INDEX IF NOT EXISTS facilities_asset_movements_to_idx
  ON public.facilities_asset_movements (to_employee_id, ack_status);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['facilities_asset_movements'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Custody view ------------------------------------------------------------

-- One row per live office asset. The holder comes from the latest movement
-- that changes custody (issue / transfer / return); the condition from the
-- latest movement of any type; last verification from the latest 'verify'.
CREATE OR REPLACE VIEW public.v_facilities_asset_custody AS
WITH custody AS (
  SELECT DISTINCT ON (m.fixed_asset_id)
         m.fixed_asset_id, m.to_employee_id AS holder_employee_id, m.movement_date AS since,
         m.accessories
    FROM public.facilities_asset_movements m
   WHERE m.movement_type IN ('issue','transfer','return')
   ORDER BY m.fixed_asset_id, m.created_at DESC
),
latest AS (
  SELECT DISTINCT ON (m.fixed_asset_id) m.fixed_asset_id, m.condition
    FROM public.facilities_asset_movements m
   ORDER BY m.fixed_asset_id, m.created_at DESC
),
verified AS (
  SELECT m.fixed_asset_id, max(m.created_at) AS last_verified_at
    FROM public.facilities_asset_movements m
   WHERE m.movement_type = 'verify'
   GROUP BY m.fixed_asset_id
)
SELECT a.id AS fixed_asset_id,
       a.asset_code, a.name, a.category, a.status, a.department_id, a.location_description,
       a.serial_number, a.model, a.manufacturer,
       d.name AS department_name,
       c.holder_employee_id,
       CASE WHEN e.id IS NULL THEN NULL ELSE e.full_name || ' (' || e.employee_code || ')' END AS holder,
       e.full_name AS holder_name, e.employee_code AS holder_code, ed.name AS holder_department,
       c.since,
       COALESCE(l.condition, 'good') AS condition,
       v.last_verified_at,
       c.accessories
  FROM public.fixed_assets a
  LEFT JOIN public.production_departments d ON d.id = a.department_id
  LEFT JOIN custody c ON c.fixed_asset_id = a.id
  LEFT JOIN latest l ON l.fixed_asset_id = a.id
  LEFT JOIN verified v ON v.fixed_asset_id = a.id
  LEFT JOIN public.employees e ON e.id = c.holder_employee_id
  LEFT JOIN public.production_departments ed ON ed.id = e.department_id
 WHERE a.category = 'office_assets' AND a.status <> 'disposed';

GRANT SELECT ON public.v_facilities_asset_custody TO anon, authenticated, service_role;

-- 3. Functions ---------------------------------------------------------------

-- The employee record linked to the caller's login (NULL when none).
CREATE OR REPLACE FUNCTION public.facilities_my_employee_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id FROM public.employees e
   WHERE e.app_user_id = public.app_user_id() AND COALESCE(e.is_active, true)
   ORDER BY e.created_at LIMIT 1;
$$;

-- Record a movement. p_data:
--   { fixed_asset_id, movement_type, to_employee_id, movement_date, condition,
--     accessories, remarks, on_paper }
-- The "from" side is always the asset's current holder (checked against
-- p_data.from_employee_id when given, so two people cannot move the same
-- asset at once from a stale screen).
CREATE OR REPLACE FUNCTION public.facilities_asset_move(p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_asset_id uuid := NULLIF(p_data->>'fixed_asset_id', '')::uuid;
  v_type text := NULLIF(btrim(p_data->>'movement_type'), '');
  v_to uuid := NULLIF(p_data->>'to_employee_id', '')::uuid;
  v_from_given uuid := NULLIF(p_data->>'from_employee_id', '')::uuid;
  v_date date := COALESCE(NULLIF(p_data->>'movement_date', '')::date, public.facilities_today());
  v_condition text := COALESCE(NULLIF(btrim(p_data->>'condition'), ''), 'good');
  v_accessories text := NULLIF(btrim(p_data->>'accessories'), '');
  v_remarks text := NULLIF(btrim(p_data->>'remarks'), '');
  v_on_paper boolean := COALESCE((p_data->>'on_paper')::boolean, false);
  v_asset record;
  v_holder uuid;
  v_to_emp record;
  v_id uuid;
  v_number text;
  v_label text;
  v_to_label text := '';
  v_to_user uuid;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to move office assets.';
  END IF;
  IF v_type IS NULL OR v_type NOT IN ('issue','return','transfer','verify') THEN
    RAISE EXCEPTION 'Choose Issue, Return, Transfer or Verify.';
  END IF;
  IF v_condition NOT IN ('new','good','fair','damaged') THEN
    RAISE EXCEPTION 'Choose the condition: new, good, fair or damaged.';
  END IF;
  IF v_date > public.facilities_today() THEN
    RAISE EXCEPTION 'The movement date cannot be in the future.';
  END IF;

  SELECT a.id, a.asset_code, a.name, a.category, a.status INTO v_asset
    FROM public.fixed_assets a WHERE a.id = v_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Choose an asset from the Fixed Asset register.';
  END IF;
  IF v_asset.category <> 'office_assets' THEN
    RAISE EXCEPTION '% % is not an office asset. Only Office Assets are issued here.', v_asset.asset_code, v_asset.name;
  END IF;
  IF v_asset.status = 'disposed' THEN
    RAISE EXCEPTION '% % has been disposed.', v_asset.asset_code, v_asset.name;
  END IF;
  v_label := v_asset.asset_code || ' ' || v_asset.name;

  SELECT c.holder_employee_id INTO v_holder
    FROM public.v_facilities_asset_custody c WHERE c.fixed_asset_id = v_asset_id;
  IF v_from_given IS DISTINCT FROM v_holder AND (p_data ? 'from_employee_id') THEN
    RAISE EXCEPTION 'The holder of % changed meanwhile. Reload the page and try again.', v_label;
  END IF;

  IF v_type = 'issue' THEN
    IF v_holder IS NOT NULL THEN
      RAISE EXCEPTION '% is already with an employee. Use Transfer (or Return it first).', v_label;
    END IF;
    IF v_to IS NULL THEN
      RAISE EXCEPTION 'Choose the employee who receives %.', v_label;
    END IF;
  ELSIF v_type = 'transfer' THEN
    IF v_holder IS NULL THEN
      RAISE EXCEPTION '% is in the admin store. Use Issue.', v_label;
    END IF;
    IF v_to IS NULL THEN
      RAISE EXCEPTION 'Choose the employee who receives %.', v_label;
    END IF;
    IF v_to = v_holder THEN
      RAISE EXCEPTION '% is already with that employee.', v_label;
    END IF;
  ELSIF v_type = 'return' THEN
    IF v_holder IS NULL THEN
      RAISE EXCEPTION '% is already in the admin store.', v_label;
    END IF;
    v_to := NULL;
  ELSE -- verify
    v_to := v_holder;
  END IF;

  IF v_to IS NOT NULL AND v_type IN ('issue','transfer') THEN
    SELECT e.id, e.full_name, e.employee_code, e.app_user_id, COALESCE(e.is_active, true) AS is_active
      INTO v_to_emp FROM public.employees e WHERE e.id = v_to;
    IF NOT FOUND OR NOT v_to_emp.is_active THEN
      RAISE EXCEPTION 'Choose an active employee.';
    END IF;
    v_to_label := ' to ' || v_to_emp.full_name || ' (' || v_to_emp.employee_code || ')';
    v_to_user := v_to_emp.app_user_id;
  END IF;

  v_number := 'AST-' || lpad(nextval('public.facilities_asset_movement_seq')::text, 6, '0');
  INSERT INTO public.facilities_asset_movements
    (movement_number, fixed_asset_id, movement_type, from_employee_id, to_employee_id, movement_date,
     condition, accessories, remarks, ack_status, acknowledged_at, created_by)
  VALUES
    (v_number, v_asset_id, v_type, v_holder, v_to, v_date, v_condition, v_accessories, v_remarks,
     CASE WHEN v_type IN ('return','verify') THEN 'acknowledged'
          WHEN v_on_paper THEN 'on_paper' ELSE 'pending' END,
     CASE WHEN v_type IN ('return','verify') OR v_on_paper THEN now() END,
     v_uid)
  RETURNING id INTO v_id;

  PERFORM public.facilities_log('asset_movement', v_id, v_type,
    v_number || ' · ' || v_label || ' · ' || v_type || v_to_label || ' · ' || v_condition,
    jsonb_build_object('fixed_asset_id', v_asset_id, 'from', v_holder, 'to', v_to, 'condition', v_condition));

  IF v_type IN ('issue','transfer') AND NOT v_on_paper AND v_to_user IS NOT NULL THEN
    PERFORM public.facilities_notify_user(v_to_user,
      'An office asset was issued to you',
      v_label || ' — open My Assets to acknowledge receipt.',
      '/my-assets', 'facilities_asset_movement', v_id, 'info');
  END IF;
  IF v_condition = 'damaged' THEN
    PERFORM public.facilities_notify_managers('Office asset reported damaged',
      v_label || ' (' || v_number || ')', '/facilities/assets', 'facilities_asset_movement', v_id, 'warning', false);
  END IF;
  RETURN v_id;
END;
$$;

-- The receiving employee confirms they got the asset.
CREATE OR REPLACE FUNCTION public.facilities_asset_acknowledge(p_movement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  m public.facilities_asset_movements%ROWTYPE;
  v_me uuid := public.facilities_my_employee_id();
BEGIN
  SELECT * INTO m FROM public.facilities_asset_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found.';
  END IF;
  IF m.ack_status <> 'pending' THEN
    RETURN;
  END IF;
  IF v_me IS NULL OR m.to_employee_id IS DISTINCT FROM v_me THEN
    RAISE EXCEPTION 'Only the employee who received this asset can acknowledge it.';
  END IF;
  UPDATE public.facilities_asset_movements
     SET ack_status = 'acknowledged', acknowledged_at = now() WHERE id = p_movement_id;
  PERFORM public.facilities_log('asset_movement', p_movement_id, 'acknowledged', 'Receipt acknowledged by the employee');
END;
$$;

-- The admin records that the employee signed the paper slip.
CREATE OR REPLACE FUNCTION public.facilities_asset_mark_on_paper(p_movement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE m public.facilities_asset_movements%ROWTYPE;
BEGIN
  IF NOT public.facilities_can('operate') THEN
    RAISE EXCEPTION 'You do not have permission to do this.';
  END IF;
  SELECT * INTO m FROM public.facilities_asset_movements WHERE id = p_movement_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Movement not found.';
  END IF;
  IF m.ack_status <> 'pending' THEN
    RETURN;
  END IF;
  UPDATE public.facilities_asset_movements
     SET ack_status = 'on_paper', acknowledged_at = now() WHERE id = p_movement_id;
  PERFORM public.facilities_log('asset_movement', p_movement_id, 'on_paper', 'Signed on paper');
END;
$$;

-- 4. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.facilities_my_employee_id(),
  public.facilities_asset_move(jsonb),
  public.facilities_asset_acknowledge(uuid),
  public.facilities_asset_mark_on_paper(uuid)
  TO anon, authenticated, service_role;
