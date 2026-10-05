-- ============================================================================
-- Dispatch Planner — Phase 1b: the five remaining functions, without any
-- destructive SQL statement
-- ----------------------------------------------------------------------------
-- The project is administered through a tool that holds every statement
-- containing a row-removing or object-removing keyword for an interactive
-- confirmation. The planner never needs either:
--
--   * a pin that is cleared is kept and marked `cleared_at` (the suggestion
--     ignores it, and saving the line again revives it);
--   * a saved version that is removed is marked `archived_at` and hidden;
--   * the suggestion engine keeps its working data in memory (jsonb maps and
--     an array of rows) instead of temporary tables, so it no longer has to
--     clear them between calls. Same rules, same output as before.
--
-- Supersedes the versions of dispatch_planner_suggest, _pin_save, _pin_clear,
-- _pins_cleanup and _version_delete in 20261010120100_dispatch_planner.sql
-- (dispatch_planner_version_delete is replaced by dispatch_planner_version_archive).
-- Rollback: supabase/rollbacks/20261010120200_dispatch_planner_no_destructive_sql_down.sql
-- ============================================================================

-- 1. Soft-removal columns -----------------------------------------------------

ALTER TABLE public.dispatch_planner_pins ADD COLUMN IF NOT EXISTS cleared_at timestamptz;
ALTER TABLE public.dispatch_planner_versions ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.dispatch_planner_versions ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES public.app_users(id);

-- 2. The row type the engine accumulates ---------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
                  WHERE n.nspname = 'public' AND t.typname = 'dispatch_planner_suggest_row') THEN
    CREATE TYPE public.dispatch_planner_suggest_row AS (
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
      pin_note text,
      seq bigint
    );
  END IF;
END $$;

-- 3. The suggestion -------------------------------------------------------------
-- Returns the suggested plan for the pending lines, with one row per line (two
-- when stock covers only part of it). Writes nothing. Rules are in
-- 20261010120100_dispatch_planner.sql and docs/DISPATCH_PLANNER.md.
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  s public.dispatch_planner_settings%ROWTYPE;
  v_today date := public.dispatch_planner_today();
  v_from date;
  v_to date;
  v_last date;
  v_fleet integer;            -- total cartons the active fleet carries in a day (0 = no fleet master yet)
  v_stale_before date;
  v_wdays date[];             -- working days from v_from to v_last
  v_used jsonb := '{}'::jsonb;    -- day → cartons already placed on it
  v_stock jsonb;              -- planning item → {closing, date, remaining}
  v_out public.dispatch_planner_suggest_row[] := '{}';
  v_row public.dispatch_planner_suggest_row;
  r record;
  i integer;
  v_key text;
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
  v_seq bigint := 0;
  v_load integer;
  v_load_used integer;
  v_load_cap integer;
  v_veh_id uuid;
  v_veh_reg text;
  v_veh_idx integer;
  v_veh_n integer;
BEGIN
  SELECT * INTO s FROM public.dispatch_planner_settings WHERE id;
  v_from := COALESCE(p_from, v_today);
  v_to := COALESCE(p_to, v_from + s.horizon_days);
  v_last := v_to + s.lead_time_days * 2 + 60;   -- room for late suggestions

  -- The day before which a closing counts as stale: stale_closing_days working days back from today.
  SELECT max(w.day) INTO v_stale_before
    FROM (SELECT day FROM public.dispatch_planner_working_days(v_today - 90, v_today) WHERE is_working ORDER BY day DESC OFFSET s.stale_closing_days LIMIT 1) w;

  SELECT COALESCE(sum(carton_capacity), 0) INTO v_fleet
    FROM public.dispatch_planner_vehicles WHERE is_active;
  SELECT count(*) INTO v_veh_n FROM public.dispatch_planner_vehicles WHERE is_active;

  SELECT COALESCE(array_agg(day ORDER BY day), '{}') INTO v_wdays
    FROM public.dispatch_planner_working_days(v_from, v_last) WHERE is_working;

  -- Paper stock per planning item.
  SELECT COALESCE(jsonb_object_agg(planning_item_id::text,
           jsonb_build_object('closing', closing_quantity, 'date', closing_date, 'remaining', closing_quantity)), '{}'::jsonb)
    INTO v_stock
    FROM public.v_dispatch_planner_fg_stock;

  -- The lines in planning order: urgent first, then deadline, then order date.
  FOR r IN
    SELECT l.*, pn.pinned_date, COALESCE(pn.urgent, false) AS urgent, pn.note AS pin_note
      FROM public.v_dispatch_planner_pending_lines l
      LEFT JOIN public.dispatch_planner_pins pn ON pn.order_item_id = l.order_item_id AND pn.cleared_at IS NULL
     ORDER BY COALESCE(pn.urgent, false) DESC, l.deadline NULLS LAST, l.order_date, l.order_number, l.order_item_id
  LOOP
    v_seq := v_seq + 1;
    v_flags := '{}';
    IF r.urgent THEN v_flags := array_append(v_flags, 'urgent'); END IF;
    IF r.packing_dozens IS NULL THEN v_flags := array_append(v_flags, 'no_packing'); END IF;
    IF r.deadline IS NULL THEN v_flags := array_append(v_flags, 'no_deadline'); END IF;

    -- 2. Allocate stock on paper.
    v_key := r.planning_item_id::text;
    IF r.planning_item_id IS NULL THEN
      v_alloc := r.pending_dozens;
      v_flags := array_append(v_flags, 'no_stock_link');
    ELSIF v_stock ? v_key THEN
      v_remaining := (v_stock->v_key->>'remaining')::numeric;
      v_alloc := LEAST(GREATEST(v_remaining, 0), r.pending_dozens);
      v_stock := jsonb_set(v_stock, ARRAY[v_key, 'remaining'], to_jsonb(v_remaining - v_alloc));
      IF (v_stock->v_key->>'date')::date < v_stale_before THEN
        v_flags := array_append(v_flags, 'stale_stock');
      END IF;
    ELSE
      v_alloc := 0;
      v_flags := array_append(v_flags, 'no_closing');
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
        SELECT min(d) INTO v_date FROM unnest(v_wdays) d WHERE d >= r.pinned_date;
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
          v_date := v_wdays[1];
          v_flags := array_append(v_flags, 'overdue');
          v_reason := 'Deadline ' || to_char(r.deadline, 'DD Mon') || ' has passed: dispatch at once';
        ELSE
          SELECT min(d) INTO v_date
            FROM unnest(v_wdays) d
           WHERE (r.deadline IS NULL OR d <= r.deadline)
             AND (v_fleet = 0 OR COALESCE((v_used->>d::text)::integer, 0) + v_cartons <= v_fleet);
          IF v_date IS NULL THEN
            -- Nothing free before the deadline: put it on the deadline (or the
            -- last working day before it) and flag the day as over the fleet.
            SELECT max(d) INTO v_date FROM unnest(v_wdays) d WHERE d <= COALESCE(r.deadline, v_to);
            v_date := COALESCE(v_date, v_wdays[1]);
            v_flags := array_append(v_flags, 'over_fleet_capacity');
            v_reason := 'Every day up to the deadline is full for the fleet; placed on ' || to_char(v_date, 'DD Mon');
          ELSE
            v_reason := CASE WHEN r.deadline IS NULL THEN 'Earliest working day with fleet capacity (order has no deadline)'
                             ELSE 'Earliest working day with fleet capacity, deadline ' || to_char(r.deadline, 'DD Mon') END;
          END IF;
        END IF;
      END IF;

      v_used := jsonb_set(v_used, ARRAY[v_date::text], to_jsonb(COALESCE((v_used->>v_date::text)::integer, 0) + v_cartons));

      v_row := (
        r.order_item_id::text || '-' || CASE WHEN v_status = 'needs_production' AND v_alloc > 0 THEN 2 ELSE 1 END,
        r.order_item_id, CASE WHEN v_status = 'needs_production' AND v_alloc > 0 THEN 2 ELSE 1 END,
        r.order_id, r.order_number, r.order_date, r.customer_id, r.customer_name, r.city,
        r.product_id, r.product_code, r.product_name, r.grade_id, r.grade_name,
        r.planning_item_id, r.planning_item_name, r.packing_type, r.packing_dozens, r.pending_dozens,
        v_part_qty, v_cartons, r.deadline,
        (v_stock->v_key->>'closing')::numeric, (v_stock->v_key->>'date')::date,
        v_status, v_date, NULL, NULL, NULL, v_flags, v_reason,
        r.pinned_date IS NOT NULL, r.pinned_date, r.urgent, r.pin_note, v_seq
      )::public.dispatch_planner_suggest_row;
      v_out := array_append(v_out, v_row);
    END LOOP;
  END LOOP;

  -- 4. Loads: per day, by city then customer, each load up to one vehicle.
  v_day := NULL;
  FOR i IN
    SELECT t.ordinality::integer FROM unnest(v_out) WITH ORDINALITY AS t
     ORDER BY t.suggested_date, t.city NULLS LAST, t.customer_name, t.seq, t.part
  LOOP
    v_row := v_out[i];
    IF v_day IS DISTINCT FROM v_row.suggested_date THEN
      v_day := v_row.suggested_date;
      v_load := 0; v_load_used := 0; v_load_cap := NULL; v_veh_idx := 0;
      v_veh_id := NULL; v_veh_reg := NULL;
    END IF;
    IF v_load = 0 OR (v_load_cap IS NOT NULL AND v_load_used + v_row.cartons > v_load_cap AND v_load_used > 0) THEN
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
    v_load_used := v_load_used + v_row.cartons;
    v_row.load_no := v_load;
    v_row.vehicle_id := v_veh_id;
    v_row.vehicle_reg := v_veh_reg;
    IF v_veh_n > 0 AND v_veh_idx > v_veh_n THEN
      v_row.flags := array_append(v_row.flags, 'second_trip');
    END IF;
    v_out[i] := v_row;
  END LOOP;

  RETURN QUERY
    SELECT o.line_key, o.order_item_id, o.part, o.order_id, o.order_number, o.order_date, o.customer_id, o.customer_name,
           o.city, o.product_id, o.product_code, o.product_name, o.grade_id, o.grade_name, o.planning_item_id, o.planning_item_name,
           o.packing_type, o.packing_dozens, o.pending_dozens, o.suggested_dozens, o.cartons, o.deadline,
           o.stock_closing, o.stock_closing_date, o.status, o.suggested_date, o.load_no, o.vehicle_id, o.vehicle_reg,
           o.flags, o.reason, o.pinned, o.pinned_date, o.urgent, o.pin_note
      FROM unnest(v_out) o
     ORDER BY o.suggested_date, o.load_no, o.city NULLS LAST, o.customer_name, o.seq, o.part;
END;
$$;

-- 4. Pins ---------------------------------------------------------------------------

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
    UPDATE public.dispatch_planner_pins SET cleared_at = now(), updated_at = now()
     WHERE order_item_id = p_order_item_id AND cleared_at IS NULL;
    RETURN;
  END IF;
  INSERT INTO public.dispatch_planner_pins (order_item_id, pinned_date, urgent, note, created_by)
  VALUES (p_order_item_id, p_pinned_date, COALESCE(p_urgent, false), NULLIF(btrim(p_note), ''), public.app_user_id())
  ON CONFLICT (order_item_id) DO UPDATE
     SET pinned_date = EXCLUDED.pinned_date, urgent = EXCLUDED.urgent, note = EXCLUDED.note,
         created_by = EXCLUDED.created_by, cleared_at = NULL, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.dispatch_planner_pin_clear(p_order_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dispatch_planner_can('plan') THEN
    RAISE EXCEPTION 'You do not have permission to adjust the dispatch plan.';
  END IF;
  UPDATE public.dispatch_planner_pins SET cleared_at = now(), updated_at = now()
   WHERE order_item_id = p_order_item_id AND cleared_at IS NULL;
END;
$$;

-- Clear pins of lines that are no longer pending. Returns how many were cleared.
CREATE OR REPLACE FUNCTION public.dispatch_planner_pins_cleanup()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF NOT public.dispatch_planner_can('plan') THEN
    RETURN 0;
  END IF;
  UPDATE public.dispatch_planner_pins p SET cleared_at = now(), updated_at = now()
   WHERE p.cleared_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.v_dispatch_planner_pending_lines l WHERE l.order_item_id = p.order_item_id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- 5. Versions -------------------------------------------------------------------------

-- Hide a saved version. Its lines are kept for the record.
CREATE OR REPLACE FUNCTION public.dispatch_planner_version_archive(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.dispatch_planner_can('manage') THEN
    RAISE EXCEPTION 'Only a dispatch planner manager can remove a saved version.';
  END IF;
  UPDATE public.dispatch_planner_versions
     SET archived_at = now(), archived_by = public.app_user_id()
   WHERE id = p_id AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found or already removed.'; END IF;
END;
$$;

-- 6. Grants ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.dispatch_planner_suggest(date, date),
  public.dispatch_planner_pin_save(uuid, date, boolean, text),
  public.dispatch_planner_pin_clear(uuid),
  public.dispatch_planner_pins_cleanup(),
  public.dispatch_planner_version_archive(uuid)
TO anon, authenticated, service_role;
