-- ============================================================================
-- Rejections & Wastage — ball inventory, Phase 1
-- ----------------------------------------------------------------------------
-- Leaker and reject balls are saleable goods, not scrap: a leaker core at Jorr
-- is covered before it is sold, covered leakers and rejects at the Final and
-- Packing departments go to the cheap-ball store. Until now the floor checker's
-- count was a bare number with nothing downstream to check it against.
--
-- Phase 1 gives that count an inventory:
--   1. Masters — defect grades (with their onward route), the bins, which
--      department counts which grade into which bin, and the value per
--      (model, defect grade).
--   2. rw_checker_entries — the daily floor count, one row per
--      (date, shift, department, model, defect grade), with an optional
--      interval breakdown that must add up when it is used.
--   3. rw_ball_ledger / rw_ball_stock — every movement with a running balance,
--      and the on-hand cache derived from it.
--   4. production_entries.quantity_rejected derived from the checker's count,
--      so the production and R&W modules can never disagree.
--   5. Coverage and defect-rate views: a department that produced but posted
--      nothing, and a defect % outside its band, both surface the same day.
--
-- Entries dated before rw_ball_cutover() stay pure log rows: no stock, and no
-- effect on production_entries. rw_rejections / rw_leakages / rw_wastages are
-- untouched — they keep pre-cutover history and the material side.
-- ============================================================================

-- 0. Cutover ----------------------------------------------------------------
-- Change this date (CREATE OR REPLACE) to move the go-live point.
CREATE OR REPLACE FUNCTION public.rw_ball_cutover()
RETURNS date LANGUAGE sql IMMUTABLE
AS $$ SELECT DATE '2026-09-01' $$;

COMMENT ON FUNCTION public.rw_ball_cutover() IS
  'Checker entries on/after this date post to the ball ledger and drive production_entries.quantity_rejected. Earlier entries are history only.';

-- 1. Masters ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_urdu text,
  location_type text NOT NULL DEFAULT 'floor_bin'
    CHECK (location_type IN ('floor_bin','leaker_wip','transit','store')),
  department_id uuid REFERENCES public.production_departments(id) ON DELETE SET NULL,
  inventory_location_id uuid REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.rw_locations.inventory_location_id IS
  'Optional bridge to the main store, for the later phase that mirrors cheap-ball stock into inventory_stock.';

CREATE TABLE IF NOT EXISTS public.rw_defect_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  name_urdu text,
  defect_type text NOT NULL CHECK (defect_type IN ('leakage','rejection')),
  detected_stage text NOT NULL DEFAULT 'finished'
    CHECK (detected_stage IN ('core','covered','finished')),
  onward_route text NOT NULL DEFAULT 'to_store'
    CHECK (onward_route IN ('to_store','cover_then_store','destroy')),
  covered_output_grade_id uuid REFERENCES public.rw_defect_grades(id) ON DELETE SET NULL,
  is_sellable boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A grade that must be covered before sale has to say what it becomes.
ALTER TABLE public.rw_defect_grades
  DROP CONSTRAINT IF EXISTS rw_defect_grades_cover_route_needs_output;
ALTER TABLE public.rw_defect_grades
  ADD CONSTRAINT rw_defect_grades_cover_route_needs_output
  CHECK (onward_route <> 'cover_then_store' OR covered_output_grade_id IS NOT NULL);

COMMENT ON COLUMN public.rw_defect_grades.onward_route IS
  'to_store: goes to the cheap-ball store as-is. cover_then_store: held as WIP until covered (Jorr leaker cores). destroy: counted for reporting, never stocked.';

-- Which department counts which grade, and into which bin. Many-to-many:
-- rejects are counted at Local Final, Fancy Final AND Packing.
CREATE TABLE IF NOT EXISTS public.rw_department_defect_grades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE CASCADE,
  defect_grade_id uuid NOT NULL REFERENCES public.rw_defect_grades(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.rw_locations(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rw_department_defect_grades_uk UNIQUE (department_id, defect_grade_id)
);

COMMENT ON TABLE public.rw_department_defect_grades IS
  'Drives the checker grid columns, resolves the destination bin so the checker never picks a location, and scopes the daily coverage check to departments that actually have a checker.';

-- Value per (model, defect grade). A cheap-grade leaker is worth less than a
-- high-grade one. product_id NULL = the default for that defect grade.
-- Mirrors standard_costs, including its COALESCE unique-index trick.
CREATE TABLE IF NOT EXISTS public.rw_defect_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES public.products(id) ON DELETE CASCADE,
  defect_grade_id uuid NOT NULL REFERENCES public.rw_defect_grades(id) ON DELETE CASCADE,
  standard_cost numeric NOT NULL DEFAULT 0,
  sale_rate numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rw_defect_rates_uniq ON public.rw_defect_rates
  (defect_grade_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Exact (product, grade) wins; otherwise the grade-wide default; otherwise 0.
CREATE OR REPLACE FUNCTION public.rw_defect_standard_cost(p_product uuid, p_grade uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT r.standard_cost
      FROM public.rw_defect_rates r
     WHERE r.defect_grade_id = p_grade
       AND r.is_active
       AND (r.product_id = p_product OR r.product_id IS NULL)
     ORDER BY (r.product_id IS NULL)     -- false sorts first: the exact match
     LIMIT 1
  ), 0);
$$;

GRANT EXECUTE ON FUNCTION public.rw_defect_standard_cost(uuid, uuid) TO anon, authenticated, service_role;

-- 2. The daily floor count --------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_checker_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text NOT NULL DEFAULT 'Day',
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE RESTRICT,
  sub_department_id uuid REFERENCES public.production_sub_departments(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  defect_grade_id uuid NOT NULL REFERENCES public.rw_defect_grades(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit text NOT NULL DEFAULT 'pcs',
  reason_id uuid REFERENCES public.rw_reasons(id) ON DELETE SET NULL,
  checked_by uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.rw_locations(id) ON DELETE SET NULL,
  remarks text,
  entered_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One line per day per shift per department per model per defect grade.
-- This is what stops a day being posted twice.
CREATE UNIQUE INDEX IF NOT EXISTS rw_checker_entries_uk ON public.rw_checker_entries
  (entry_date, shift, department_id,
   COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
   product_id, defect_grade_id);
CREATE INDEX IF NOT EXISTS rw_checker_entries_date_idx
  ON public.rw_checker_entries (entry_date, department_id);

-- Optional interval tally. Never required; when present it must add up.
CREATE TABLE IF NOT EXISTS public.rw_checker_entry_intervals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.rw_checker_entries(id) ON DELETE CASCADE,
  interval_no integer NOT NULL CHECK (interval_no > 0),
  quantity numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rw_checker_entry_intervals_uk UNIQUE (entry_id, interval_no)
);

-- 3. Ledger and stock -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rw_ball_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL DEFAULT CURRENT_DATE,
  location_id uuid NOT NULL REFERENCES public.rw_locations(id) ON DELETE RESTRICT,
  department_id uuid REFERENCES public.production_departments(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  defect_grade_id uuid NOT NULL REFERENCES public.rw_defect_grades(id) ON DELETE RESTRICT,
  unit text NOT NULL DEFAULT 'pcs',
  quantity_in numeric NOT NULL DEFAULT 0,
  quantity_out numeric NOT NULL DEFAULT 0,
  balance_quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  value_in numeric NOT NULL DEFAULT 0,
  value_out numeric NOT NULL DEFAULT 0,
  balance_value numeric NOT NULL DEFAULT 0,
  source_type text NOT NULL CHECK (source_type IN
    ('checker_entry','cover_out','cover_in','handover_out','handover_in',
     'store_receipt','count_adjustment','sale_issue','opening')),
  source_id uuid,
  reference_number text,
  remarks text,
  entered_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotent posting: one ledger row per source document per item per location.
CREATE UNIQUE INDEX IF NOT EXISTS rw_ball_ledger_source_uk ON public.rw_ball_ledger
  (source_type, source_id, location_id, product_id, defect_grade_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS rw_ball_ledger_item_idx
  ON public.rw_ball_ledger (product_id, defect_grade_id, txn_date);
CREATE INDEX IF NOT EXISTS rw_ball_ledger_series_idx
  ON public.rw_ball_ledger (location_id, product_id, defect_grade_id, txn_date, created_at);

CREATE TABLE IF NOT EXISTS public.rw_ball_stock (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.rw_locations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  defect_grade_id uuid NOT NULL REFERENCES public.rw_defect_grades(id) ON DELETE CASCADE,
  unit text NOT NULL DEFAULT 'pcs',
  quantity numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  stock_value numeric NOT NULL DEFAULT 0,
  first_movement_date date,
  last_movement_date timestamptz,
  last_counted_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rw_ball_stock_uk UNIQUE (location_id, product_id, defect_grade_id)
);

-- 4. Running balances -------------------------------------------------------
-- The ledger is the source of truth; rw_ball_stock is a cache derived from it.
-- Entries can be back-dated, so a series is renumbered rather than appended to.
CREATE OR REPLACE FUNCTION public.rw_rebuild_ball_series(
  p_location uuid, p_product uuid, p_grade uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty numeric := 0;
  v_val numeric := 0;
  v_first date;
  v_last timestamptz;
  v_cost numeric := 0;
BEGIN
  WITH ordered AS (
    SELECT id,
           SUM(quantity_in - quantity_out) OVER w AS bal_qty,
           SUM(value_in - value_out)       OVER w AS bal_val
      FROM public.rw_ball_ledger
     WHERE location_id = p_location
       AND product_id = p_product
       AND defect_grade_id = p_grade
    WINDOW w AS (ORDER BY txn_date, created_at, id
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  )
  UPDATE public.rw_ball_ledger l
     SET balance_quantity = o.bal_qty,
         balance_value    = o.bal_val
    FROM ordered o
   WHERE l.id = o.id
     AND (l.balance_quantity IS DISTINCT FROM o.bal_qty
       OR l.balance_value    IS DISTINCT FROM o.bal_val);

  SELECT COALESCE(SUM(quantity_in - quantity_out), 0),
         COALESCE(SUM(value_in - value_out), 0),
         MIN(txn_date), MAX(created_at)
    INTO v_qty, v_val, v_first, v_last
    FROM public.rw_ball_ledger
   WHERE location_id = p_location
     AND product_id = p_product
     AND defect_grade_id = p_grade;

  v_cost := CASE WHEN v_qty <> 0 THEN v_val / v_qty
                 ELSE public.rw_defect_standard_cost(p_product, p_grade) END;

  IF v_first IS NULL THEN
    DELETE FROM public.rw_ball_stock
     WHERE location_id = p_location AND product_id = p_product AND defect_grade_id = p_grade;
    RETURN;
  END IF;

  INSERT INTO public.rw_ball_stock AS s
    (location_id, product_id, defect_grade_id, quantity, unit_cost, stock_value,
     first_movement_date, last_movement_date)
  VALUES (p_location, p_product, p_grade, v_qty, v_cost, v_val, v_first, v_last)
  ON CONFLICT (location_id, product_id, defect_grade_id) DO UPDATE
    SET quantity            = EXCLUDED.quantity,
        unit_cost           = EXCLUDED.unit_cost,
        stock_value         = EXCLUDED.stock_value,
        first_movement_date = EXCLUDED.first_movement_date,
        last_movement_date  = EXCLUDED.last_movement_date,
        updated_at          = now();
END;
$$;

-- Any ledger change renumbers its own series. The guard keeps the balance
-- UPDATE inside rw_rebuild_ball_series from re-entering this trigger.
CREATE OR REPLACE FUNCTION public.rw_ball_ledger_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('rw.rebuilding', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('rw.rebuilding', 'on', true);

  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.rw_rebuild_ball_series(NEW.location_id, NEW.product_id, NEW.defect_grade_id);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF TG_OP = 'DELETE'
       OR (OLD.location_id, OLD.product_id, OLD.defect_grade_id)
          IS DISTINCT FROM (NEW.location_id, NEW.product_id, NEW.defect_grade_id) THEN
      PERFORM public.rw_rebuild_ball_series(OLD.location_id, OLD.product_id, OLD.defect_grade_id);
    END IF;
  END IF;

  PERFORM set_config('rw.rebuilding', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rw_ball_ledger_after ON public.rw_ball_ledger;
CREATE TRIGGER trg_rw_ball_ledger_after
  AFTER INSERT OR UPDATE OR DELETE ON public.rw_ball_ledger
  FOR EACH ROW EXECUTE FUNCTION public.rw_ball_ledger_after_change();

-- 5. Posting a checker entry ------------------------------------------------
-- Route decides where (or whether) the count becomes stock:
--   to_store         -> the department's cheap-ball bin
--   cover_then_store -> the department's leaker-WIP bin, held until covered
--   destroy          -> counted and reported, never stocked
CREATE OR REPLACE FUNCTION public.rw_post_checker_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_loc   uuid;
  v_route text;
  v_cost  numeric;
BEGIN
  -- Remove any previously posted row for this entry; a re-post writes it fresh.
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM public.rw_ball_ledger
     WHERE source_type = 'checker_entry' AND source_id = OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.rw_sync_production_rejected(
      OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.product_id);
    RETURN OLD;
  END IF;

  IF NEW.entry_date >= public.rw_ball_cutover() AND NEW.quantity > 0 THEN
    SELECT dg.onward_route INTO v_route
      FROM public.rw_defect_grades dg WHERE dg.id = NEW.defect_grade_id;

    v_loc := NEW.location_id;
    IF v_loc IS NULL THEN
      SELECT m.location_id INTO v_loc
        FROM public.rw_department_defect_grades m
       WHERE m.department_id = NEW.department_id
         AND m.defect_grade_id = NEW.defect_grade_id
         AND m.is_active;
    END IF;

    IF v_route <> 'destroy' AND v_loc IS NOT NULL THEN
      v_cost := public.rw_defect_standard_cost(NEW.product_id, NEW.defect_grade_id);
      INSERT INTO public.rw_ball_ledger
        (txn_date, location_id, department_id, product_id, defect_grade_id, unit,
         quantity_in, unit_cost, value_in, source_type, source_id, entered_by, remarks)
      VALUES
        (NEW.entry_date, v_loc, NEW.department_id, NEW.product_id, NEW.defect_grade_id,
         NEW.unit, NEW.quantity, v_cost, NEW.quantity * v_cost,
         'checker_entry', NEW.id, NEW.entered_by, NEW.remarks);
    END IF;
  END IF;

  PERFORM public.rw_sync_production_rejected(
    NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.product_id);
  RETURN NEW;
END;
$$;

-- 6. Interval lines must add up when they are used --------------------------
CREATE OR REPLACE FUNCTION public.rw_check_interval_sum()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entry uuid := COALESCE(NEW.entry_id, OLD.entry_id);
  v_lines integer;
  v_sum   numeric;
  v_qty   numeric;
BEGIN
  SELECT COUNT(*), COALESCE(SUM(quantity), 0)
    INTO v_lines, v_sum
    FROM public.rw_checker_entry_intervals WHERE entry_id = v_entry;

  IF v_lines = 0 THEN
    RETURN NULL;                     -- no breakdown is always fine
  END IF;

  SELECT quantity INTO v_qty FROM public.rw_checker_entries WHERE id = v_entry;
  IF v_qty IS NULL THEN
    RETURN NULL;                     -- parent already gone (cascade delete)
  END IF;

  IF v_sum <> v_qty THEN
    RAISE EXCEPTION
      'Interval breakdown adds to % but the day total is %. They must match, or record no intervals at all.',
      v_sum, v_qty;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_rw_interval_sum ON public.rw_checker_entry_intervals;
CREATE CONSTRAINT TRIGGER trg_rw_interval_sum
  AFTER INSERT OR UPDATE OR DELETE ON public.rw_checker_entry_intervals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.rw_check_interval_sum();

-- 7. production_entries.quantity_rejected derives from the checker's count ---
-- "Rejected" in the production module means every ball that was not OK, so the
-- derived figure sums ALL defect grades — leakers included. Deriving only
-- defect_type='rejection' would leave ok + rejected <> produced.
-- products.grade_id bridges the grains: checker entries are per model,
-- production entries are per grade.
CREATE OR REPLACE FUNCTION public.rw_defect_qty_for_production(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(e.quantity), 0)
    FROM public.rw_checker_entries e
    JOIN public.products p ON p.id = e.product_id
   WHERE e.entry_date = p_date
     AND e.shift = p_shift
     AND e.department_id = p_department
     AND COALESCE(e.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
     AND p.grade_id = p_grade;
$$;

GRANT EXECUTE ON FUNCTION public.rw_defect_qty_for_production(date, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- production_entries has no unique key on (date, shift, department, sub-department,
-- grade), so a key can legitimately carry several rows. Writing the day's whole
-- defect figure to each of them would multiply the plant's rejected total, so the
-- figure is apportioned across them pro-rata by quantity_produced. The cumulative
-- rounding below makes the parts add back to the whole exactly.
CREATE OR REPLACE FUNCTION public.rw_apportion_production_rejected(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_qty numeric;
BEGIN
  IF p_date < public.rw_ball_cutover() OR p_grade IS NULL THEN
    RETURN;
  END IF;

  v_qty := public.rw_defect_qty_for_production(
    p_date, p_shift, p_department, p_sub_department, p_grade);

  WITH target AS (
    SELECT pe.id,
           COALESCE(pe.quantity_produced, 0) AS qp,
           SUM(COALESCE(pe.quantity_produced, 0)) OVER (ORDER BY pe.created_at, pe.id) AS cum,
           SUM(COALESCE(pe.quantity_produced, 0)) OVER ()                              AS tot,
           ROW_NUMBER() OVER (ORDER BY pe.created_at, pe.id)                           AS rn
      FROM public.production_entries pe
     WHERE pe.entry_date = p_date
       AND pe.shift = p_shift
       AND pe.department_id = p_department
       AND COALESCE(pe.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
       AND pe.grade_id = p_grade
  ), alloc AS (
    SELECT id, qp,
           CASE
             WHEN tot > 0 THEN ROUND(v_qty * cum / tot) - ROUND(v_qty * (cum - qp) / tot)
             WHEN rn = 1  THEN v_qty        -- nothing produced: park it on the first row
             ELSE 0
           END AS rej
      FROM target
  )
  UPDATE public.production_entries pe
     SET quantity_rejected = a.rej,
         quantity_ok       = GREATEST(a.qp - a.rej, 0),
         updated_at        = now()
    FROM alloc a
   WHERE pe.id = a.id
     AND (pe.quantity_rejected IS DISTINCT FROM a.rej
       OR pe.quantity_ok       IS DISTINCT FROM GREATEST(a.qp - a.rej, 0));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rw_apportion_production_rejected(date, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- A checker entry pushes the number onto whatever production rows exist.
CREATE OR REPLACE FUNCTION public.rw_sync_production_rejected(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_product uuid
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_grade uuid;
BEGIN
  SELECT grade_id INTO v_grade FROM public.products WHERE id = p_product;
  IF v_grade IS NULL THEN
    RETURN;                          -- model not linked to a production grade
  END IF;
  PERFORM public.rw_apportion_production_rejected(
    p_date, p_shift, p_department, p_sub_department, v_grade);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rw_sync_production_rejected(date, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- ...and saving a production entry re-apportions its own key, so a row added or
-- edited later lands on the right share without waiting for the next count.
CREATE OR REPLACE FUNCTION public.rw_production_entry_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('rw.apportioning', true), '') = 'on' THEN
    RETURN NULL;                     -- our own UPDATE coming back round
  END IF;
  PERFORM set_config('rw.apportioning', 'on', true);

  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.rw_apportion_production_rejected(
      NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.grade_id);
  END IF;
  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND
         (OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.grade_id)
         IS DISTINCT FROM
         (NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.grade_id)) THEN
    PERFORM public.rw_apportion_production_rejected(
      OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.grade_id);
  END IF;

  PERFORM set_config('rw.apportioning', 'off', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_entries_derive_rejected ON public.production_entries;
DROP TRIGGER IF EXISTS trg_production_entries_apportion ON public.production_entries;
CREATE TRIGGER trg_production_entries_apportion
  AFTER INSERT OR UPDATE OR DELETE ON public.production_entries
  FOR EACH ROW EXECUTE FUNCTION public.rw_production_entry_after_change();

-- Now the checker-entry trigger can be attached (it calls the sync above).
DROP TRIGGER IF EXISTS trg_rw_checker_entries_post ON public.rw_checker_entries;
CREATE TRIGGER trg_rw_checker_entries_post
  AFTER INSERT OR UPDATE OR DELETE ON public.rw_checker_entries
  FOR EACH ROW EXECUTE FUNCTION public.rw_post_checker_entry();

-- 8. Views ------------------------------------------------------------------

-- A department that produced but posted no count. Scoped to departments that
-- actually have a checker, so it never asks Press for a number it cannot give.
CREATE OR REPLACE VIEW public.v_rw_entry_coverage
WITH (security_invoker = on) AS
WITH checkpoints AS (
  SELECT DISTINCT department_id
    FROM public.rw_department_defect_grades WHERE is_active
),
produced AS (
  SELECT pe.entry_date, pe.shift, pe.department_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS produced_qty
    FROM public.production_entries pe
    JOIN checkpoints c ON c.department_id = pe.department_id
   WHERE pe.entry_date >= public.rw_ball_cutover()
   GROUP BY pe.entry_date, pe.shift, pe.department_id
),
counted AS (
  SELECT e.entry_date, e.shift, e.department_id,
         COUNT(*) AS entry_count, SUM(e.quantity) AS defect_qty
    FROM public.rw_checker_entries e
   GROUP BY e.entry_date, e.shift, e.department_id
)
SELECT p.entry_date,
       p.shift,
       p.department_id,
       d.name                              AS department_name,
       p.produced_qty,
       COALESCE(c.entry_count, 0)          AS entry_count,
       COALESCE(c.defect_qty, 0)           AS defect_qty,
       (c.entry_count IS NULL)             AS is_missing
  FROM produced p
  JOIN public.production_departments d ON d.id = p.department_id
  LEFT JOIN counted c
    ON c.entry_date = p.entry_date
   AND c.shift = p.shift
   AND c.department_id = p.department_id;

COMMENT ON VIEW public.v_rw_entry_coverage IS
  'Department-days with production but no checker entry. Silence is the cheapest way to hide balls; this is what makes it visible.';

-- Defect % per day, shift, department and grade, against what was produced.
CREATE OR REPLACE VIEW public.v_rw_defect_vs_production
WITH (security_invoker = on) AS
WITH prod AS (
  SELECT pe.entry_date, pe.shift, pe.department_id, pe.grade_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS produced_qty
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
   GROUP BY pe.entry_date, pe.shift, pe.department_id, pe.grade_id
), def AS (
  SELECT e.entry_date, e.shift, e.department_id, p.grade_id,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'leakage'), 0)   AS leak_qty,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'rejection'), 0) AS reject_qty
    FROM public.rw_checker_entries e
    JOIN public.products p          ON p.id  = e.product_id
    JOIN public.rw_defect_grades dg ON dg.id = e.defect_grade_id
   GROUP BY e.entry_date, e.shift, e.department_id, p.grade_id
)
SELECT pr.entry_date,
       pr.shift,
       pr.department_id,
       d.name                                    AS department_name,
       pr.grade_id,
       g.code                                    AS grade_code,
       pr.produced_qty,
       COALESCE(df.leak_qty, 0)                  AS leak_qty,
       COALESCE(df.reject_qty, 0)                AS reject_qty,
       COALESCE(df.leak_qty, 0) + COALESCE(df.reject_qty, 0) AS defect_qty,
       CASE WHEN pr.produced_qty > 0
            THEN ROUND(100.0 * (COALESCE(df.leak_qty, 0) + COALESCE(df.reject_qty, 0))
                       / pr.produced_qty, 2)
            ELSE NULL END                        AS defect_pct
  FROM prod pr
  JOIN public.production_departments d ON d.id = pr.department_id
  JOIN public.grades g                 ON g.id = pr.grade_id
  LEFT JOIN def df
    ON df.entry_date    = pr.entry_date
   AND df.shift         = pr.shift
   AND df.department_id = pr.department_id
   AND df.grade_id      = pr.grade_id;

COMMENT ON VIEW public.v_rw_defect_vs_production IS
  'Live defect rate per production key. An implausible count is visible on the day it is typed, not when the store is next counted.';

-- 9. updated_at triggers, RLS and grants ------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rw_locations','rw_defect_grades','rw_department_defect_grades','rw_defect_rates',
    'rw_checker_entries','rw_checker_entry_intervals','rw_ball_stock'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated BEFORE UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t, t);
  END LOOP;
END $$;

-- Same anon-auth model as the rest of the module.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rw_locations','rw_defect_grades','rw_department_defect_grades','rw_defect_rates',
    'rw_checker_entries','rw_checker_entry_intervals','rw_ball_ledger','rw_ball_stock'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I '
                   'FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon, authenticated, service_role;', t);
  END LOOP;
END $$;

GRANT SELECT ON public.v_rw_entry_coverage, public.v_rw_defect_vs_production
  TO anon, authenticated, service_role;

-- 10. Seed ------------------------------------------------------------------
-- Defect grades. LEAK_COVERED first: LEAK_CORE points at it.
INSERT INTO public.rw_defect_grades
  (code, name, name_urdu, defect_type, detected_stage, onward_route, sort_order)
VALUES
  ('LEAK_COVERED','Leaker — covered', NULL, 'leakage',  'covered',  'to_store', 10),
  ('REJ_SPOT',    'Reject — black spot', NULL, 'rejection','finished','to_store', 20),
  ('REJ_SEAM',    'Reject — seam finish', NULL, 'rejection','finished','to_store', 30)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.rw_defect_grades
  (code, name, name_urdu, defect_type, detected_stage, onward_route, covered_output_grade_id, sort_order)
SELECT 'LEAK_CORE','Leaker — core (Jorr)', NULL, 'leakage','core','cover_then_store', dg.id, 5
  FROM public.rw_defect_grades dg WHERE dg.code = 'LEAK_COVERED'
ON CONFLICT (code) DO NOTHING;

-- Bins, plus the transit and store locations the next phase needs.
INSERT INTO public.rw_locations (code, name, location_type, department_id)
SELECT v.code, v.name, v.ltype, d.id
  FROM (VALUES
    ('JORR-LEAK',  'Jorr — leaker cores',        'leaker_wip', 'JORR'),
    ('LF-CHEAP',   'Local Final — cheap balls',  'floor_bin',  'LOCAL_FINAL'),
    ('FF-CHEAP',   'Fancy Final — cheap balls',  'floor_bin',  'FANCY_FINAL'),
    ('PACK-CHEAP', 'Packing — cheap balls',      'floor_bin',  'PACKING')
  ) AS v(code, name, ltype, dept_code)
  JOIN public.production_departments d ON d.code = v.dept_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.rw_locations (code, name, location_type) VALUES
  ('TRANSIT',     'In transit to store', 'transit'),
  ('STORE-CHEAP', 'Cheap ball store',    'store')
ON CONFLICT (code) DO NOTHING;

-- Who counts what, into which bin.
INSERT INTO public.rw_department_defect_grades (department_id, defect_grade_id, location_id, sort_order)
SELECT d.id, dg.id, l.id, v.sort_order
  FROM (VALUES
    ('JORR',        'LEAK_CORE',    'JORR-LEAK',  10),
    ('LOCAL_FINAL', 'LEAK_COVERED', 'LF-CHEAP',   10),
    ('LOCAL_FINAL', 'REJ_SPOT',     'LF-CHEAP',   20),
    ('LOCAL_FINAL', 'REJ_SEAM',     'LF-CHEAP',   30),
    ('FANCY_FINAL', 'LEAK_COVERED', 'FF-CHEAP',   10),
    ('FANCY_FINAL', 'REJ_SPOT',     'FF-CHEAP',   20),
    ('FANCY_FINAL', 'REJ_SEAM',     'FF-CHEAP',   30),
    ('PACKING',     'REJ_SPOT',     'PACK-CHEAP', 20),
    ('PACKING',     'REJ_SEAM',     'PACK-CHEAP', 30)
  ) AS v(dept_code, grade_code, loc_code, sort_order)
  JOIN public.production_departments d ON d.code  = v.dept_code
  JOIN public.rw_defect_grades dg      ON dg.code = v.grade_code
  JOIN public.rw_locations l           ON l.code  = v.loc_code
ON CONFLICT (department_id, defect_grade_id) DO NOTHING;
