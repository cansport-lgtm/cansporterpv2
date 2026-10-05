-- ============================================================================
-- Dispatch Planner — Phase 1: suggested dispatch plan
-- ----------------------------------------------------------------------------
-- A READ-ONLY planner. It reads the pending domestic sales order lines, the
-- latest finished-goods closing stock, the factory calendar and its own fleet
-- master, and SUGGESTS a dispatch day and a load for every pending line. It
-- never creates a dispatch, a job order, a stock movement or a voucher, and it
-- adds no trigger or column to any other module's tables. The office still
-- makes the DC on the Domestic Dispatch page; production still types the job
-- orders. The planner's only writes are to its own dispatch_planner_* tables:
-- officer pins, saved plan versions, the vehicle master and the settings.
--
-- Rules of the suggestion (dispatch_planner_suggest):
--   1. Lines are ordered urgent first, then by deadline (expected_dispatch_date),
--      then by order date. A pin fixes a line's day.
--   2. Finished-goods stock is allocated ON PAPER in that order from the latest
--      daily_stock_closing of the product's planning item. A line gets all of
--      it (dispatchable), part of it (partial → two rows) or none of it
--      (needs production). A product with no planning item is flagged and
--      treated as dispatchable.
--   3. A dispatchable row is placed on the earliest working day from today up
--      to the deadline that still has fleet carton capacity; past the deadline
--      it goes on today and is flagged overdue.
--   4. Within a day, rows are grouped into loads by city then customer, each
--      load up to one vehicle's carton capacity (biggest vehicles first). A day
--      needing more cartons than the whole active fleet is flagged.
--   5. A needs-production row is placed lead_time_days working days from today
--      and flagged "will be late" when that is after the deadline.
-- Every row carries the rule that placed it so the board can explain itself.
--
-- Rollback: supabase/rollbacks/20261009120100_dispatch_planner_down.sql
-- Roles are added in 20261009120000_dispatch_planner_roles.sql.
-- ============================================================================

-- 1. Planner-owned tables ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dispatch_planner_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  horizon_days integer NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 1 AND 90),
  lead_time_days integer NOT NULL DEFAULT 7 CHECK (lead_time_days BETWEEN 0 AND 90),
  -- How old (in working days) the latest closing may be before the board flags it stale.
  stale_closing_days integer NOT NULL DEFAULT 1 CHECK (stale_closing_days BETWEEN 0 AND 30),
  sunday_off boolean NOT NULL DEFAULT true,
  use_public_holidays boolean NOT NULL DEFAULT true,
  segments text[] NOT NULL DEFAULT ARRAY['domestic'],
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.dispatch_planner_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- The fleet the planner fills. Planner-owned reference data; nothing else uses it.
CREATE TABLE IF NOT EXISTS public.dispatch_planner_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_no text NOT NULL,
  vehicle_type text NOT NULL DEFAULT 'own' CHECK (vehicle_type IN ('own','hired')),
  carton_capacity integer NOT NULL CHECK (carton_capacity > 0),
  transporter_name text,
  default_driver_name text,
  default_driver_contact text,
  is_active boolean NOT NULL DEFAULT true,
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dispatch_planner_vehicles_reg_uk
  ON public.dispatch_planner_vehicles (upper(btrim(registration_no)));

-- An officer's adjustment that survives re-suggesting: a fixed day and / or an
-- urgent flag on one pending order line. Keyed by the order item's id only (no
-- foreign key, so the sales module is never blocked by the planner); pins of
-- lines that are no longer pending are removed by dispatch_planner_pins_cleanup.
CREATE TABLE IF NOT EXISTS public.dispatch_planner_pins (
  order_item_id uuid PRIMARY KEY,
  pinned_date date,
  urgent boolean NOT NULL DEFAULT false,
  note text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispatch_planner_pins_something_ck CHECK (pinned_date IS NOT NULL OR urgent OR note IS NOT NULL)
);

-- A saved suggestion, as the board showed it when the officer pressed Save.
CREATE SEQUENCE IF NOT EXISTS public.dispatch_planner_version_seq;

CREATE TABLE IF NOT EXISTS public.dispatch_planner_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_number text NOT NULL UNIQUE
    DEFAULT 'DPV-' || lpad(nextval('public.dispatch_planner_version_seq')::text, 6, '0'),
  horizon_from date NOT NULL,
  horizon_to date NOT NULL,
  label text,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  line_count integer NOT NULL DEFAULT 0,
  total_dozens numeric NOT NULL DEFAULT 0,
  total_cartons integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispatch_planner_versions_created_idx ON public.dispatch_planner_versions (created_at DESC);

CREATE TABLE IF NOT EXISTS public.dispatch_planner_version_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.dispatch_planner_versions(id) ON DELETE CASCADE,
  plan_date date NOT NULL,
  load_no integer,
  vehicle_id uuid,
  vehicle_reg text,
  city text,
  order_id uuid,
  order_number text,
  order_item_id uuid,
  part integer NOT NULL DEFAULT 1,
  customer_name text,
  product_id uuid,
  product_code text,
  product_name text,
  grade_name text,
  planning_item_id uuid,
  packing_type text,
  deadline date,
  suggested_dozens numeric NOT NULL DEFAULT 0,
  cartons integer NOT NULL DEFAULT 0,
  status_at_save text NOT NULL,
  flags text[] NOT NULL DEFAULT '{}',
  pinned boolean NOT NULL DEFAULT false,
  urgent boolean NOT NULL DEFAULT false,
  reason text
);
CREATE INDEX IF NOT EXISTS dispatch_planner_version_lines_version_idx
  ON public.dispatch_planner_version_lines (version_id, plan_date, load_no);
CREATE INDEX IF NOT EXISTS dispatch_planner_version_lines_item_idx
  ON public.dispatch_planner_version_lines (order_item_id);

-- Read-only to clients: SELECT policies only, so every write goes through the
-- role-checked functions below.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dispatch_planner_settings','dispatch_planner_vehicles','dispatch_planner_pins',
                           'dispatch_planner_versions','dispatch_planner_version_lines'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Read-only views over the other modules ----------------------------------
-- Plain SELECTs; the rollback drops them and nothing else depends on them.

-- One row per open domestic order line with something left to dispatch.
CREATE OR REPLACE VIEW public.v_dispatch_planner_pending_lines AS
SELECT soi.id AS order_item_id,
       so.id AS order_id,
       so.order_number,
       so.order_date,
       so.status AS order_status,
       so.expected_dispatch_date AS deadline,
       so.required_date,
       so.customer_id,
       cu.name AS customer_name,
       NULLIF(btrim(cu.city), '') AS city,
       NULLIF(btrim(cu.area), '') AS area,
       soi.product_id,
       p.code AS product_code,
       p.name AS product_name,
       soi.grade_id,
       g.name AS grade_name,
       p.planning_item_id,
       pi.name AS planning_item_name,
       soi.packing_type,
       pt.dozens AS packing_dozens,
       soi.quantity_dozens,
       COALESCE(soi.quantity_dispatched, 0) AS quantity_dispatched,
       soi.quantity_dozens - COALESCE(soi.quantity_dispatched, 0) AS pending_dozens,
       CASE WHEN pt.dozens IS NOT NULL AND pt.dozens > 0
            THEN ceil((soi.quantity_dozens - COALESCE(soi.quantity_dispatched, 0)) / pt.dozens)::integer
            ELSE ceil((soi.quantity_dozens - COALESCE(soi.quantity_dispatched, 0)) / 12)::integer END AS pending_cartons,
       soi.production_instructions,
       soi.remarks
  FROM public.sales_order_items soi
  JOIN public.sales_orders so ON so.id = soi.order_id
  JOIN public.customers cu ON cu.id = so.customer_id
  LEFT JOIN public.products p ON p.id = soi.product_id
  LEFT JOIN public.grades g ON g.id = soi.grade_id
  LEFT JOIN public.planning_items pi ON pi.id = p.planning_item_id
  LEFT JOIN LATERAL (
    SELECT x.dozens FROM public.packing_types x
     WHERE lower(btrim(x.label)) = lower(btrim(soi.packing_type))
     ORDER BY x.is_active DESC, x.sort_order LIMIT 1
  ) pt ON true
 WHERE so.sales_segment = 'domestic'
   AND so.status IN ('confirmed','in_production','ready','partially_dispatched')
   AND soi.quantity_dozens - COALESCE(soi.quantity_dispatched, 0) > 0;

-- The latest closing stock of every planning item.
CREATE OR REPLACE VIEW public.v_dispatch_planner_fg_stock AS
SELECT DISTINCT ON (c.planning_item_id)
       c.planning_item_id,
       pi.name AS planning_item_name,
       c.closing_quantity,
       c.closing_date
  FROM public.daily_stock_closing c
  JOIN public.planning_items pi ON pi.id = c.planning_item_id
 ORDER BY c.planning_item_id, c.closing_date DESC, c.updated_at DESC NULLS LAST;

GRANT SELECT ON public.v_dispatch_planner_pending_lines, public.v_dispatch_planner_fg_stock
  TO anon, authenticated, service_role;

-- 3. Helpers -----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_planner_has_any_role(p_roles text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
     WHERE user_id = public.app_user_id() AND role::text = ANY (p_roles)
  );
$$;

-- plan     → pin / flag lines, save plan versions
-- manage   → vehicle master, delete versions
-- settings → the module settings
CREATE OR REPLACE FUNCTION public.dispatch_planner_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.dispatch_planner_has_any_role(CASE p_action
    WHEN 'plan' THEN ARRAY['super_admin','dispatch_planner_manager','dispatch_planner_officer']
    WHEN 'manage' THEN ARRAY['super_admin','dispatch_planner_manager']
    WHEN 'settings' THEN ARRAY['super_admin']
    ELSE ARRAY[]::text[] END);
$$;

-- Today in the factory's time zone.
CREATE OR REPLACE FUNCTION public.dispatch_planner_today()
RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Asia/Karachi')::date; $$;

-- The factory calendar between two dates: Sundays and active public holidays
-- are not working days (each switchable in the settings).
CREATE OR REPLACE FUNCTION public.dispatch_planner_working_days(p_from date, p_to date)
RETURNS TABLE (day date, is_working boolean, reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT d::date AS day,
         NOT (
           (s.sunday_off AND extract(isodow FROM d) = 7)
           OR (s.use_public_holidays AND h.name IS NOT NULL)
         ) AS is_working,
         CASE WHEN s.sunday_off AND extract(isodow FROM d) = 7 THEN 'Sunday'
              WHEN s.use_public_holidays AND h.name IS NOT NULL THEN h.name
              ELSE NULL END AS reason
    FROM generate_series(p_from, p_to, interval '1 day') d
   CROSS JOIN public.dispatch_planner_settings s
    LEFT JOIN LATERAL (
      SELECT ph.name FROM public.public_holidays ph
       WHERE ph.holiday_date = d::date AND ph.is_active LIMIT 1
    ) h ON true
   ORDER BY d;
$$;

-- The n-th working day on or after p_from (n = 0 → p_from itself if working).
CREATE OR REPLACE FUNCTION public.dispatch_planner_add_working_days(p_from date, p_days integer)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT day FROM (
    SELECT day, row_number() OVER (ORDER BY day) - 1 AS n
      FROM public.dispatch_planner_working_days(p_from, p_from + (p_days * 2 + 30))
     WHERE is_working
  ) w WHERE n = GREATEST(p_days, 0) LIMIT 1;
$$;

-- 4. The suggestion ----------------------------------------------------------
-- Returns the suggested plan for the pending lines, with one row per line (two
-- when stock covers only part of it). Writes nothing.
CREATE OR REPLACE FUNCTION public.dispatch_planner_suggest(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS TABLE (
  line_key text,
  order_item_id uuid,
  part integer,
  order_id uuid,
  order_number text,
  order_date date,
  customer_id uuid,
  customer_name text,
  city text,
  product_id uuid,
  product_code text,
  product_name text,
  grade_id uuid,
  grade_name text,
  planning_item_id uuid,
  planning_item_name text,
  packing_type text,
  packing_dozens numeric,
  pending_dozens numeric,
  suggested_dozens numeric,
  cartons integer,
  deadline date,
  stock_closing numeric,
  stock_closing_date date,
  status text,
  suggested_date date,
  load_no integer,
  vehicle_id uuid,
  vehicle_reg text,
  flags text[],
  reason text,
  pinned boolean,
  pinned_date date,
  urgent boolean,
  pin_note text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  s public.dispatch_planner_settings%ROWTYPE;
  v_today date := public.dispatch_planner_today();
  v_from date;
  v_to date;
  v_last date;
  v_fleet integer;          -- total cartons the active fleet carries in a day (0 = no fleet master yet)
  v_stale_before date;
  r record;
  v_alloc numeric;
  v_remaining numeric;
  v_date date;
  v_day date;
  v_flags text[];
  v_reason text;
  v_status text;
  v_cartons integer;
  v_part_qty numeric;
  v_late integer;
  v_load integer;
  v_load_city text;
  v_load_used integer;
  v_load_cap integer;
  v_veh_id uuid;
  v_veh_reg text;
  v_veh_idx integer;
  v_veh_n integer;
BEGIN
  -- The temp tables below are dropped and recreated on every call; keep the
  -- "does not exist, skipping" notices out of the API logs.
  PERFORM set_config('client_min_messages', 'warning', true);
  SELECT * INTO s FROM public.dispatch_planner_settings WHERE id;
  v_from := COALESCE(p_from, v_today);
  v_to := COALESCE(p_to, v_from + s.horizon_days);
  v_last := v_to + s.lead_time_days * 2 + 60;   -- room for late suggestions

  -- The day before which a closing counts as stale: stale_closing_days working days back from today.
  SELECT max(w.day) INTO v_stale_before
    FROM (SELECT day FROM public.dispatch_planner_working_days(v_today - 90, v_today) WHERE is_working ORDER BY day DESC OFFSET s.stale_closing_days LIMIT 1) w;

  SELECT COALESCE(sum(carton_capacity), 0) INTO v_fleet
    FROM public.dispatch_planner_vehicles WHERE is_active;

  -- Working calendar with a running carton total per day.
  DROP TABLE IF EXISTS tmp_dp_days;
  CREATE TEMP TABLE tmp_dp_days ON COMMIT DROP AS
  SELECT day, is_working, reason, 0::integer AS cartons_used
    FROM public.dispatch_planner_working_days(v_from, v_last);

  -- Paper stock per planning item.
  DROP TABLE IF EXISTS tmp_dp_stock;
  CREATE TEMP TABLE tmp_dp_stock ON COMMIT DROP AS
  SELECT planning_item_id, closing_quantity, closing_date, closing_quantity AS remaining
    FROM public.v_dispatch_planner_fg_stock;

  -- The lines in planning order.
  DROP TABLE IF EXISTS tmp_dp_lines;
  CREATE TEMP TABLE tmp_dp_lines ON COMMIT DROP AS
  SELECT l.*,
         pn.pinned_date, COALESCE(pn.urgent, false) AS urgent, pn.note AS pin_note,
         row_number() OVER (ORDER BY COALESCE(pn.urgent, false) DESC, l.deadline NULLS LAST, l.order_date, l.order_number, l.order_item_id) AS seq
    FROM public.v_dispatch_planner_pending_lines l
    LEFT JOIN public.dispatch_planner_pins pn ON pn.order_item_id = l.order_item_id;

  DROP TABLE IF EXISTS tmp_dp_out;
  CREATE TEMP TABLE tmp_dp_out ON COMMIT DROP AS
  SELECT NULL::text AS line_key, NULL::uuid AS order_item_id, 0::integer AS part, NULL::uuid AS order_id,
         NULL::text AS order_number, NULL::date AS order_date, NULL::uuid AS customer_id, NULL::text AS customer_name,
         NULL::text AS city, NULL::uuid AS product_id, NULL::text AS product_code, NULL::text AS product_name,
         NULL::uuid AS grade_id, NULL::text AS grade_name, NULL::uuid AS planning_item_id, NULL::text AS planning_item_name,
         NULL::text AS packing_type, NULL::numeric AS packing_dozens, NULL::numeric AS pending_dozens,
         NULL::numeric AS suggested_dozens, 0::integer AS cartons, NULL::date AS deadline,
         NULL::numeric AS stock_closing, NULL::date AS stock_closing_date, NULL::text AS status,
         NULL::date AS suggested_date, NULL::integer AS load_no, NULL::uuid AS vehicle_id, NULL::text AS vehicle_reg,
         '{}'::text[] AS flags, NULL::text AS reason, false AS pinned, NULL::date AS pinned_date, false AS urgent,
         NULL::text AS pin_note, 0::bigint AS seq
   WHERE false;

  FOR r IN SELECT * FROM tmp_dp_lines ORDER BY seq LOOP
    v_flags := '{}';
    IF r.urgent THEN v_flags := array_append(v_flags, 'urgent'); END IF;
    IF r.packing_dozens IS NULL THEN v_flags := array_append(v_flags, 'no_packing'); END IF;
    IF r.deadline IS NULL THEN v_flags := array_append(v_flags, 'no_deadline'); END IF;

    -- 2. Allocate stock on paper.
    IF r.planning_item_id IS NULL THEN
      v_alloc := r.pending_dozens;
      v_flags := array_append(v_flags, 'no_stock_link');
    ELSE
      SELECT remaining INTO v_remaining FROM tmp_dp_stock WHERE planning_item_id = r.planning_item_id;
      IF NOT FOUND THEN
        v_alloc := 0;
        v_flags := array_append(v_flags, 'no_closing');
      ELSE
        v_alloc := LEAST(GREATEST(v_remaining, 0), r.pending_dozens);
        UPDATE tmp_dp_stock SET remaining = remaining - v_alloc WHERE planning_item_id = r.planning_item_id;
        IF (SELECT closing_date FROM tmp_dp_stock WHERE planning_item_id = r.planning_item_id) < v_stale_before THEN
          v_flags := array_append(v_flags, 'stale_stock');
        END IF;
      END IF;
    END IF;

    -- One or two parts: what stock covers, and what production must make.
    FOR v_part_qty, v_status IN
      SELECT q, st FROM (VALUES
        (v_alloc, CASE WHEN v_alloc >= r.pending_dozens THEN 'dispatchable' ELSE 'partial' END),
        (r.pending_dozens - v_alloc, 'needs_production')
      ) v(q, st) WHERE q > 0
    LOOP
      v_cartons := ceil(v_part_qty / COALESCE(NULLIF(r.packing_dozens, 0), 12))::integer;
      v_date := NULL;
      v_reason := NULL;
      v_late := NULL;

      IF r.pinned_date IS NOT NULL AND v_status <> 'needs_production' THEN
        -- 1. A pin fixes the day (moved to the next working day if it is not one).
        SELECT min(day) INTO v_date FROM tmp_dp_days WHERE day >= r.pinned_date AND is_working;
        v_date := COALESCE(v_date, r.pinned_date);
        v_reason := 'Pinned to ' || to_char(r.pinned_date, 'DD Mon') ||
                    CASE WHEN v_date <> r.pinned_date THEN ' (moved to the next working day)' ELSE '' END;
        IF r.deadline IS NOT NULL AND v_date > r.deadline THEN v_flags := array_append(v_flags, 'after_deadline'); END IF;
      ELSIF v_status = 'needs_production' THEN
        -- 5. Production first: lead time from today, then dispatch.
        v_date := public.dispatch_planner_add_working_days(GREATEST(v_from, v_today), s.lead_time_days);
        v_reason := 'No stock: ' || s.lead_time_days || ' working days lead time from today';
        IF r.deadline IS NOT NULL AND v_date > r.deadline THEN
          v_late := v_date - r.deadline;
          v_flags := array_append(v_flags, 'will_be_late');
          v_reason := v_reason || ' — ' || v_late || ' day(s) after the deadline';
        END IF;
        IF r.pinned_date IS NOT NULL THEN v_flags := array_append(v_flags, 'pin_ignored'); END IF;
      ELSE
        -- 3. Earliest working day from today to the deadline with fleet capacity.
        IF r.deadline IS NOT NULL AND r.deadline < v_from THEN
          SELECT min(day) INTO v_date FROM tmp_dp_days WHERE is_working;
          v_flags := array_append(v_flags, 'overdue');
          v_reason := 'Deadline ' || to_char(r.deadline, 'DD Mon') || ' has passed: dispatch at once';
        ELSE
          SELECT min(day) INTO v_date
            FROM tmp_dp_days
           WHERE is_working
             AND (r.deadline IS NULL OR day <= r.deadline)
             AND (v_fleet = 0 OR cartons_used + v_cartons <= v_fleet);
          IF v_date IS NULL THEN
            -- Nothing free before the deadline: put it on the deadline (or the
            -- last working day before it) and flag the day as over the fleet.
            SELECT max(day) INTO v_date FROM tmp_dp_days WHERE is_working AND day <= COALESCE(r.deadline, v_to);
            SELECT COALESCE(v_date, min(day)) INTO v_date FROM tmp_dp_days WHERE is_working;
            v_flags := array_append(v_flags, 'over_fleet_capacity');
            v_reason := 'Every day up to the deadline is full for the fleet; placed on ' || to_char(v_date, 'DD Mon');
          ELSE
            v_reason := CASE WHEN r.deadline IS NULL THEN 'Earliest working day with fleet capacity (order has no deadline)'
                             ELSE 'Earliest working day with fleet capacity, deadline ' || to_char(r.deadline, 'DD Mon') END;
          END IF;
        END IF;
      END IF;

      UPDATE tmp_dp_days SET cartons_used = cartons_used + v_cartons WHERE day = v_date;

      INSERT INTO tmp_dp_out
      VALUES (r.order_item_id::text || '-' || CASE WHEN v_status = 'needs_production' AND v_alloc > 0 THEN 2 ELSE 1 END,
              r.order_item_id, CASE WHEN v_status = 'needs_production' AND v_alloc > 0 THEN 2 ELSE 1 END,
              r.order_id, r.order_number, r.order_date, r.customer_id, r.customer_name, r.city,
              r.product_id, r.product_code, r.product_name, r.grade_id, r.grade_name,
              r.planning_item_id, r.planning_item_name, r.packing_type, r.packing_dozens, r.pending_dozens,
              v_part_qty, v_cartons, r.deadline,
              (SELECT closing_quantity FROM tmp_dp_stock WHERE planning_item_id = r.planning_item_id),
              (SELECT closing_date FROM tmp_dp_stock WHERE planning_item_id = r.planning_item_id),
              v_status, v_date, NULL, NULL, NULL, v_flags, v_reason,
              r.pinned_date IS NOT NULL, r.pinned_date, r.urgent, r.pin_note, r.seq);
    END LOOP;
  END LOOP;

  -- 4. Loads: per day, by city then customer, each load up to one vehicle.
  SELECT count(*) INTO v_veh_n FROM public.dispatch_planner_vehicles WHERE is_active;
  FOR v_day IN SELECT DISTINCT o.suggested_date FROM tmp_dp_out o ORDER BY 1 LOOP
    v_load := 0; v_load_city := NULL; v_load_used := 0; v_load_cap := NULL; v_veh_idx := 0;
    v_veh_id := NULL; v_veh_reg := NULL;
    FOR r IN SELECT o.line_key, o.city, o.customer_name, o.cartons
               FROM tmp_dp_out o WHERE o.suggested_date = v_day
              ORDER BY o.city NULLS LAST, o.customer_name, o.seq, o.part LOOP
      IF v_load = 0 OR (v_load_cap IS NOT NULL AND v_load_used + r.cartons > v_load_cap AND v_load_used > 0) THEN
        v_load := v_load + 1;
        v_load_used := 0;
        IF v_veh_n > 0 THEN
          -- Biggest vehicles first, then round again when the fleet is used up.
          SELECT v.id, v.registration_no, v.carton_capacity INTO v_veh_id, v_veh_reg, v_load_cap
            FROM public.dispatch_planner_vehicles v WHERE v.is_active
           ORDER BY v.carton_capacity DESC, v.registration_no
          OFFSET (v_veh_idx % v_veh_n) LIMIT 1;
          v_veh_idx := v_veh_idx + 1;
        ELSE
          v_veh_id := NULL; v_veh_reg := NULL; v_load_cap := NULL;
        END IF;
      END IF;
      v_load_used := v_load_used + r.cartons;
      UPDATE tmp_dp_out o
         SET load_no = v_load,
             vehicle_id = v_veh_id,
             vehicle_reg = v_veh_reg,
             flags = CASE WHEN v_veh_n > 0 AND v_veh_idx > v_veh_n THEN array_append(o.flags, 'second_trip') ELSE o.flags END
       WHERE o.line_key = r.line_key;
    END LOOP;
  END LOOP;

  RETURN QUERY
    SELECT o.line_key, o.order_item_id, o.part, o.order_id, o.order_number, o.order_date, o.customer_id, o.customer_name,
           o.city, o.product_id, o.product_code, o.product_name, o.grade_id, o.grade_name, o.planning_item_id, o.planning_item_name,
           o.packing_type, o.packing_dozens, o.pending_dozens, o.suggested_dozens, o.cartons, o.deadline,
           o.stock_closing, o.stock_closing_date, o.status, o.suggested_date, o.load_no, o.vehicle_id, o.vehicle_reg,
           o.flags, o.reason, o.pinned, o.pinned_date, o.urgent, o.pin_note
      FROM tmp_dp_out o
     ORDER BY o.suggested_date, o.load_no, o.city NULLS LAST, o.customer_name, o.seq, o.part;
END;
$$;

-- 5. Writes to the planner's own tables ---------------------------------------

CREATE OR REPLACE FUNCTION public.dispatch_planner_pin_save(
  p_order_item_id uuid, p_pinned_date date DEFAULT NULL, p_urgent boolean DEFAULT false, p_note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dispatch_planner_can('plan') THEN
    RAISE EXCEPTION 'You do not have permission to adjust the dispatch plan.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.v_dispatch_planner_pending_lines WHERE order_item_id = p_order_item_id) THEN
    RAISE EXCEPTION 'This order line is no longer pending.';
  END IF;
  IF p_pinned_date IS NULL AND NOT COALESCE(p_urgent, false) AND NULLIF(btrim(p_note), '') IS NULL THEN
    DELETE FROM public.dispatch_planner_pins WHERE order_item_id = p_order_item_id;
    RETURN;
  END IF;
  INSERT INTO public.dispatch_planner_pins (order_item_id, pinned_date, urgent, note, created_by)
  VALUES (p_order_item_id, p_pinned_date, COALESCE(p_urgent, false), NULLIF(btrim(p_note), ''), public.app_user_id())
  ON CONFLICT (order_item_id) DO UPDATE
     SET pinned_date = EXCLUDED.pinned_date, urgent = EXCLUDED.urgent, note = EXCLUDED.note,
         created_by = EXCLUDED.created_by, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_planner_pin_clear(p_order_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dispatch_planner_can('plan') THEN
    RAISE EXCEPTION 'You do not have permission to adjust the dispatch plan.';
  END IF;
  DELETE FROM public.dispatch_planner_pins WHERE order_item_id = p_order_item_id;
END;
$$;

-- Drop pins of lines that are no longer pending. Returns how many were removed.
CREATE OR REPLACE FUNCTION public.dispatch_planner_pins_cleanup()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.dispatch_planner_can('plan') THEN
    RETURN 0;
  END IF;
  DELETE FROM public.dispatch_planner_pins p
   WHERE NOT EXISTS (SELECT 1 FROM public.v_dispatch_planner_pending_lines l WHERE l.order_item_id = p.order_item_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Save the board as a version. p_lines: the rows of dispatch_planner_suggest as
-- the board showed them (same field names).
CREATE OR REPLACE FUNCTION public.dispatch_planner_version_save(
  p_from date, p_to date, p_label text, p_lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid;
  s public.dispatch_planner_settings%ROWTYPE;
BEGIN
  IF NOT public.dispatch_planner_can('plan') THEN
    RAISE EXCEPTION 'You do not have permission to save a plan version.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'There is nothing to save.';
  END IF;
  SELECT * INTO s FROM public.dispatch_planner_settings WHERE id;

  INSERT INTO public.dispatch_planner_versions (horizon_from, horizon_to, label, params, created_by)
  VALUES (p_from, p_to, NULLIF(btrim(p_label), ''),
          jsonb_build_object('lead_time_days', s.lead_time_days, 'horizon_days', s.horizon_days,
                             'fleet_cartons', (SELECT COALESCE(sum(carton_capacity), 0) FROM public.dispatch_planner_vehicles WHERE is_active)),
          public.app_user_id())
  RETURNING id INTO v_id;

  INSERT INTO public.dispatch_planner_version_lines (
    version_id, plan_date, load_no, vehicle_id, vehicle_reg, city, order_id, order_number, order_item_id, part,
    customer_name, product_id, product_code, product_name, grade_name, planning_item_id, packing_type, deadline,
    suggested_dozens, cartons, status_at_save, flags, pinned, urgent, reason)
  SELECT v_id,
         (x->>'suggested_date')::date,
         (x->>'load_no')::integer,
         NULLIF(x->>'vehicle_id', '')::uuid,
         x->>'vehicle_reg',
         x->>'city',
         NULLIF(x->>'order_id', '')::uuid,
         x->>'order_number',
         NULLIF(x->>'order_item_id', '')::uuid,
         COALESCE((x->>'part')::integer, 1),
         x->>'customer_name',
         NULLIF(x->>'product_id', '')::uuid,
         x->>'product_code',
         x->>'product_name',
         x->>'grade_name',
         NULLIF(x->>'planning_item_id', '')::uuid,
         x->>'packing_type',
         NULLIF(x->>'deadline', '')::date,
         COALESCE((x->>'suggested_dozens')::numeric, 0),
         COALESCE((x->>'cartons')::integer, 0),
         COALESCE(x->>'status', 'dispatchable'),
         COALESCE((SELECT array_agg(f) FROM jsonb_array_elements_text(COALESCE(x->'flags', '[]'::jsonb)) f), '{}'),
         COALESCE((x->>'pinned')::boolean, false),
         COALESCE((x->>'urgent')::boolean, false),
         x->>'reason'
    FROM jsonb_array_elements(p_lines) x
   WHERE x->>'suggested_date' IS NOT NULL;

  UPDATE public.dispatch_planner_versions v
     SET line_count = (SELECT count(*) FROM public.dispatch_planner_version_lines l WHERE l.version_id = v_id),
         total_dozens = (SELECT COALESCE(sum(suggested_dozens), 0) FROM public.dispatch_planner_version_lines l WHERE l.version_id = v_id),
         total_cartons = (SELECT COALESCE(sum(cartons), 0) FROM public.dispatch_planner_version_lines l WHERE l.version_id = v_id)
   WHERE v.id = v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_planner_version_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dispatch_planner_can('manage') THEN
    RAISE EXCEPTION 'Only a dispatch planner manager can delete a saved version.';
  END IF;
  DELETE FROM public.dispatch_planner_versions WHERE id = p_id;
END;
$$;

-- p_data: { registration_no*, vehicle_type, carton_capacity*, transporter_name,
--           default_driver_name, default_driver_contact, is_active, remarks }
CREATE OR REPLACE FUNCTION public.dispatch_planner_vehicle_save(p_id uuid, p_data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_id uuid := p_id;
  v_reg text := NULLIF(upper(btrim(p_data->>'registration_no')), '');
  v_cap integer := NULLIF(p_data->>'carton_capacity', '')::integer;
  v_type text := COALESCE(NULLIF(btrim(p_data->>'vehicle_type'), ''), 'own');
BEGIN
  IF NOT public.dispatch_planner_can('manage') THEN
    RAISE EXCEPTION 'Only a dispatch planner manager can change the vehicles.';
  END IF;
  IF v_reg IS NULL THEN RAISE EXCEPTION 'Enter the registration number.'; END IF;
  IF v_cap IS NULL OR v_cap <= 0 THEN RAISE EXCEPTION 'Enter the carton capacity (more than 0).'; END IF;
  IF v_type NOT IN ('own','hired') THEN RAISE EXCEPTION 'The vehicle type must be own or hired.'; END IF;
  IF EXISTS (SELECT 1 FROM public.dispatch_planner_vehicles v
              WHERE upper(btrim(v.registration_no)) = v_reg AND (v_id IS NULL OR v.id <> v_id)) THEN
    RAISE EXCEPTION 'Vehicle % is already in the list.', v_reg;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.dispatch_planner_vehicles (registration_no, vehicle_type, carton_capacity, transporter_name,
      default_driver_name, default_driver_contact, is_active, remarks, created_by)
    VALUES (v_reg, v_type, v_cap, NULLIF(btrim(p_data->>'transporter_name'), ''),
      NULLIF(btrim(p_data->>'default_driver_name'), ''), NULLIF(btrim(p_data->>'default_driver_contact'), ''),
      COALESCE((p_data->>'is_active')::boolean, true), NULLIF(btrim(p_data->>'remarks'), ''), public.app_user_id())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.dispatch_planner_vehicles
       SET registration_no = v_reg, vehicle_type = v_type, carton_capacity = v_cap,
           transporter_name = NULLIF(btrim(p_data->>'transporter_name'), ''),
           default_driver_name = NULLIF(btrim(p_data->>'default_driver_name'), ''),
           default_driver_contact = NULLIF(btrim(p_data->>'default_driver_contact'), ''),
           is_active = COALESCE((p_data->>'is_active')::boolean, is_active),
           remarks = NULLIF(btrim(p_data->>'remarks'), ''),
           updated_at = now()
     WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found.'; END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- p_data: { horizon_days, lead_time_days, stale_closing_days, sunday_off, use_public_holidays }
CREATE OR REPLACE FUNCTION public.dispatch_planner_settings_save(p_data jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dispatch_planner_can('settings') THEN
    RAISE EXCEPTION 'Only a super admin can change the dispatch planner settings.';
  END IF;
  UPDATE public.dispatch_planner_settings
     SET horizon_days = COALESCE(NULLIF(p_data->>'horizon_days', '')::integer, horizon_days),
         lead_time_days = COALESCE(NULLIF(p_data->>'lead_time_days', '')::integer, lead_time_days),
         stale_closing_days = COALESCE(NULLIF(p_data->>'stale_closing_days', '')::integer, stale_closing_days),
         sunday_off = COALESCE((p_data->>'sunday_off')::boolean, sunday_off),
         use_public_holidays = COALESCE((p_data->>'use_public_holidays')::boolean, use_public_holidays),
         updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 6. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.dispatch_planner_has_any_role(text[]),
  public.dispatch_planner_can(text),
  public.dispatch_planner_today(),
  public.dispatch_planner_working_days(date, date),
  public.dispatch_planner_add_working_days(date, integer),
  public.dispatch_planner_suggest(date, date),
  public.dispatch_planner_pin_save(uuid, date, boolean, text),
  public.dispatch_planner_pin_clear(uuid),
  public.dispatch_planner_pins_cleanup(),
  public.dispatch_planner_version_save(date, date, text, jsonb),
  public.dispatch_planner_version_delete(uuid),
  public.dispatch_planner_vehicle_save(uuid, jsonb),
  public.dispatch_planner_settings_save(jsonb)
TO anon, authenticated, service_role;
