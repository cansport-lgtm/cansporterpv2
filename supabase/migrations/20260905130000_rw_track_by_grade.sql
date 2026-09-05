-- ============================================================================
-- R&W ball inventory — track by GRADE, the production module's master
-- ----------------------------------------------------------------------------
-- Phase 1 keyed the checker's count to products (sales SKUs). The floor has
-- never thought in products: all 2,349 historical leakage rows and 591 of 602
-- rejection rows identify the ball as stage + grade ("JORR VM72",
-- "FINAL T70 YELLOW"), and the production module books output per grade. The
-- product keying forced a products.grade_id bridge that was unset on most
-- models, so counts posted to the ledger but silently never reached
-- production_entries.quantity_rejected — visible in the first week of live
-- use, where 14 of 16 entries pointed at unlinked SKUs.
--
-- This migration re-keys the ball inventory to public.grades:
--   * rw_checker_entries, rw_ball_ledger, rw_ball_stock and rw_defect_rates
--     carry grade_id instead of product_id.
--   * Existing entries whose product is linked to a grade are mapped across;
--     the rest are deleted (per the plant: "map whatever you can, delete the
--     rest"). Ledger and stock are wiped and reposted from the surviving
--     entries, so balances are rebuilt on the new key.
--   * The derivation no longer needs a bridge: a checker entry and a
--     production entry now share (date, shift, department, grade) directly.
--   * The unlinked-models machinery (v_rw_unlinked_models) is dropped —
--     the failure mode it reported can no longer exist.
--
-- Material wastage is deliberately untouched: rw_wastages keeps hp_materials,
-- because solvent, compound and kapra have no ball grade.
-- ============================================================================

-- 0. Out with the product-dependent views first -----------------------------
-- Both reference rw_checker_entries.product_id and would block the column
-- drops below. v_rw_defect_vs_production is recreated on the new key in §4;
-- v_rw_unlinked_models is gone for good — a grade-keyed entry cannot be
-- "unlinked", so the failure mode it reported no longer exists.
DROP VIEW IF EXISTS public.v_rw_unlinked_models;
DROP VIEW IF EXISTS public.v_rw_defect_vs_production;
-- ...and this one depends on rw_defect_qty_for_production, whose signature is
-- unchanged but whose parameter names are not — the DROP it needs is blocked
-- while the view stands. Recreated verbatim in §4.
DROP VIEW IF EXISTS public.v_rw_posted_entry_conflicts;

-- 0b. Map what can be mapped, delete the rest -------------------------------
-- Deletes fire the existing posting trigger, which cleans the ledger rows and
-- stock for those entries while the product-keyed functions still exist.
-- Guarded so a re-run after product_id is gone is a no-op.
ALTER TABLE public.rw_checker_entries
  ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES public.grades(id) ON DELETE RESTRICT;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = 'rw_checker_entries'
                AND column_name = 'product_id') THEN
    DELETE FROM public.rw_checker_entries e
     USING public.products p
     WHERE p.id = e.product_id
       AND p.grade_id IS NULL;

    UPDATE public.rw_checker_entries e
       SET grade_id = p.grade_id
      FROM public.products p
     WHERE p.id = e.product_id
       AND e.grade_id IS NULL;
  END IF;
END
$do$;

-- 1. Re-key rw_checker_entries ----------------------------------------------

-- Two products mapping to the same grade can collide on the daily key: merge
-- into the earliest row (summing quantities, dropping interval tallies for
-- the merged rows so the sum constraint cannot be contradicted).
WITH ranked AS (
  SELECT id,
         FIRST_VALUE(id) OVER w AS keep_id,
         SUM(quantity)   OVER (PARTITION BY entry_date, shift, department_id,
                    COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    grade_id, defect_grade_id) AS total_qty,
         COUNT(*)        OVER (PARTITION BY entry_date, shift, department_id,
                    COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    grade_id, defect_grade_id) AS n
    FROM public.rw_checker_entries
  WINDOW w AS (PARTITION BY entry_date, shift, department_id,
                    COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
                    grade_id, defect_grade_id
               ORDER BY created_at, id
               ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
), dupes AS (
  SELECT * FROM ranked WHERE n > 1
)
, cleared AS (
  DELETE FROM public.rw_checker_entry_intervals i
   USING dupes d WHERE i.entry_id = d.id
  RETURNING 1
)
, merged AS (
  UPDATE public.rw_checker_entries e
     SET quantity = d.total_qty
    FROM dupes d
   WHERE e.id = d.id AND d.id = d.keep_id
  RETURNING 1
)
DELETE FROM public.rw_checker_entries e
 USING dupes d
 WHERE e.id = d.id AND d.id <> d.keep_id;

ALTER TABLE public.rw_checker_entries ALTER COLUMN grade_id SET NOT NULL;

DROP INDEX IF EXISTS rw_checker_entries_uk;
CREATE UNIQUE INDEX rw_checker_entries_uk ON public.rw_checker_entries
  (entry_date, shift, department_id,
   COALESCE(sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid),
   grade_id, defect_grade_id);

ALTER TABLE public.rw_checker_entries DROP COLUMN IF EXISTS product_id;

-- 2. Re-key ledger, stock and rates -----------------------------------------
-- The ledger's only writers so far are checker entries; it is wiped here and
-- reposted from the surviving entries at the end, so balances rebuild cleanly
-- on the grade key.
DELETE FROM public.rw_ball_ledger;
DELETE FROM public.rw_ball_stock;

ALTER TABLE public.rw_ball_ledger
  ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES public.grades(id) ON DELETE RESTRICT;
ALTER TABLE public.rw_ball_ledger ALTER COLUMN grade_id SET NOT NULL;
DROP INDEX IF EXISTS rw_ball_ledger_source_uk;
DROP INDEX IF EXISTS rw_ball_ledger_item_idx;
DROP INDEX IF EXISTS rw_ball_ledger_series_idx;
ALTER TABLE public.rw_ball_ledger DROP COLUMN IF EXISTS product_id;
CREATE UNIQUE INDEX rw_ball_ledger_source_uk ON public.rw_ball_ledger
  (source_type, source_id, location_id, grade_id, defect_grade_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX rw_ball_ledger_item_idx
  ON public.rw_ball_ledger (grade_id, defect_grade_id, txn_date);
CREATE INDEX rw_ball_ledger_series_idx
  ON public.rw_ball_ledger (location_id, grade_id, defect_grade_id, txn_date, created_at);

ALTER TABLE public.rw_ball_stock
  ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES public.grades(id) ON DELETE CASCADE;
ALTER TABLE public.rw_ball_stock ALTER COLUMN grade_id SET NOT NULL;
ALTER TABLE public.rw_ball_stock DROP CONSTRAINT IF EXISTS rw_ball_stock_uk;
ALTER TABLE public.rw_ball_stock DROP COLUMN IF EXISTS product_id;
ALTER TABLE public.rw_ball_stock
  ADD CONSTRAINT rw_ball_stock_uk UNIQUE (location_id, grade_id, defect_grade_id);

-- Rates: none were defined yet, so the swap is structural only.
DELETE FROM public.rw_defect_rates;
ALTER TABLE public.rw_defect_rates
  ADD COLUMN IF NOT EXISTS grade_id uuid REFERENCES public.grades(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS rw_defect_rates_uniq;
ALTER TABLE public.rw_defect_rates DROP COLUMN IF EXISTS product_id;
CREATE UNIQUE INDEX rw_defect_rates_uniq ON public.rw_defect_rates
  (defect_grade_id, COALESCE(grade_id, '00000000-0000-0000-0000-000000000000'::uuid));

COMMENT ON COLUMN public.rw_defect_rates.grade_id IS
  'Production grade this rate applies to. NULL = the default for the defect grade; an exact grade match wins.';

-- 3. Functions on the new key -----------------------------------------------
DROP FUNCTION IF EXISTS public.rw_defect_standard_cost(uuid, uuid);
CREATE FUNCTION public.rw_defect_standard_cost(p_ball_grade uuid, p_defect uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT r.standard_cost
      FROM public.rw_defect_rates r
     WHERE r.defect_grade_id = p_defect
       AND r.is_active
       AND (r.grade_id = p_ball_grade OR r.grade_id IS NULL)
     ORDER BY (r.grade_id IS NULL)       -- false sorts first: the exact match
     LIMIT 1
  ), 0);
$$;
GRANT EXECUTE ON FUNCTION public.rw_defect_standard_cost(uuid, uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.rw_rebuild_ball_series(uuid, uuid, uuid);
CREATE FUNCTION public.rw_rebuild_ball_series(
  p_location uuid, p_ball_grade uuid, p_defect uuid
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
       AND grade_id = p_ball_grade
       AND defect_grade_id = p_defect
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
     AND grade_id = p_ball_grade
     AND defect_grade_id = p_defect;

  v_cost := CASE WHEN v_qty <> 0 THEN v_val / v_qty
                 ELSE public.rw_defect_standard_cost(p_ball_grade, p_defect) END;

  IF v_first IS NULL THEN
    DELETE FROM public.rw_ball_stock
     WHERE location_id = p_location AND grade_id = p_ball_grade AND defect_grade_id = p_defect;
    RETURN;
  END IF;

  INSERT INTO public.rw_ball_stock AS s
    (location_id, grade_id, defect_grade_id, quantity, unit_cost, stock_value,
     first_movement_date, last_movement_date)
  VALUES (p_location, p_ball_grade, p_defect, v_qty, v_cost, v_val, v_first, v_last)
  ON CONFLICT (location_id, grade_id, defect_grade_id) DO UPDATE
    SET quantity            = EXCLUDED.quantity,
        unit_cost           = EXCLUDED.unit_cost,
        stock_value         = EXCLUDED.stock_value,
        first_movement_date = EXCLUDED.first_movement_date,
        last_movement_date  = EXCLUDED.last_movement_date,
        updated_at          = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.rw_ball_ledger_after_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF COALESCE(current_setting('rw.rebuilding', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  PERFORM set_config('rw.rebuilding', 'on', true);

  IF TG_OP IN ('INSERT','UPDATE') THEN
    PERFORM public.rw_rebuild_ball_series(NEW.location_id, NEW.grade_id, NEW.defect_grade_id);
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    IF TG_OP = 'DELETE'
       OR (OLD.location_id, OLD.grade_id, OLD.defect_grade_id)
          IS DISTINCT FROM (NEW.location_id, NEW.grade_id, NEW.defect_grade_id) THEN
      PERFORM public.rw_rebuild_ball_series(OLD.location_id, OLD.grade_id, OLD.defect_grade_id);
    END IF;
  END IF;

  PERFORM set_config('rw.rebuilding', 'off', true);
  RETURN NULL;
END;
$$;

-- The bridge is gone: a checker entry now names the production grade itself.
DROP FUNCTION IF EXISTS public.rw_defect_qty_for_production(date, text, uuid, uuid, uuid);
CREATE FUNCTION public.rw_defect_qty_for_production(
  p_date date, p_shift text, p_department uuid, p_sub_department uuid, p_grade uuid
) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(e.quantity), 0)
    FROM public.rw_checker_entries e
   WHERE e.entry_date = p_date
     AND e.shift = p_shift
     AND e.department_id = p_department
     AND COALESCE(e.sub_department_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = COALESCE(p_sub_department, '00000000-0000-0000-0000-000000000000'::uuid)
     AND e.grade_id = p_grade;
$$;
GRANT EXECUTE ON FUNCTION public.rw_defect_qty_for_production(date, text, uuid, uuid, uuid)
  TO anon, authenticated, service_role;

-- rw_sync_production_rejected existed only to resolve product -> grade.
DROP FUNCTION IF EXISTS public.rw_sync_production_rejected(date, text, uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.rw_post_checker_entry()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_loc   uuid;
  v_route text;
  v_cost  numeric;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM public.rw_ball_ledger
     WHERE source_type = 'checker_entry' AND source_id = OLD.id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    PERFORM public.rw_apportion_production_rejected(
      OLD.entry_date, OLD.shift, OLD.department_id, OLD.sub_department_id, OLD.grade_id);
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
      v_cost := public.rw_defect_standard_cost(NEW.grade_id, NEW.defect_grade_id);
      INSERT INTO public.rw_ball_ledger
        (txn_date, location_id, department_id, grade_id, defect_grade_id, unit,
         quantity_in, unit_cost, value_in, source_type, source_id, entered_by, remarks)
      VALUES
        (NEW.entry_date, v_loc, NEW.department_id, NEW.grade_id, NEW.defect_grade_id,
         NEW.unit, NEW.quantity, v_cost, NEW.quantity * v_cost,
         'checker_entry', NEW.id, NEW.entered_by, NEW.remarks);
    END IF;
  END IF;

  PERFORM public.rw_apportion_production_rejected(
    NEW.entry_date, NEW.shift, NEW.department_id, NEW.sub_department_id, NEW.grade_id);
  RETURN NEW;
END;
$$;

-- 4. Views on the new key ---------------------------------------------------
CREATE VIEW public.v_rw_defect_vs_production
WITH (security_invoker = on) AS
WITH prod AS (
  SELECT pe.entry_date, pe.shift, pe.department_id, pe.grade_id,
         SUM(COALESCE(pe.quantity_produced, 0)) AS produced_qty
    FROM public.production_entries pe
   WHERE pe.entry_date >= public.rw_ball_cutover()
     AND NOT public.rw_is_defect_output_grade(pe.grade_id)
   GROUP BY pe.entry_date, pe.shift, pe.department_id, pe.grade_id
), def AS (
  SELECT e.entry_date, e.shift, e.department_id, e.grade_id,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'leakage'), 0)   AS leak_qty,
         COALESCE(SUM(e.quantity) FILTER (WHERE dg.defect_type = 'rejection'), 0) AS reject_qty
    FROM public.rw_checker_entries e
    JOIN public.rw_defect_grades dg ON dg.id = e.defect_grade_id
   GROUP BY e.entry_date, e.shift, e.department_id, e.grade_id
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

GRANT SELECT ON public.v_rw_defect_vs_production TO anon, authenticated, service_role;

-- Recreated verbatim: only its function dependency forced the drop.
CREATE VIEW public.v_rw_posted_entry_conflicts
WITH (security_invoker = on) AS
SELECT pe.entry_date,
       pe.shift,
       pe.department_id,
       d.name                                    AS department_name,
       pe.grade_id,
       g.code                                    AS grade_code,
       SUM(COALESCE(pe.quantity_rejected, 0))    AS posted_rejected,
       public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       )                                         AS counted_rejected,
       public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       ) - SUM(COALESCE(pe.quantity_rejected, 0)) AS variance_qty,
       COUNT(*)                                  AS posted_rows
  FROM public.production_entries pe
  JOIN public.production_departments d ON d.id = pe.department_id
  JOIN public.grades g                 ON g.id = pe.grade_id
 WHERE pe.status = 'Posted'
   AND pe.entry_date >= public.rw_ball_cutover()
   AND NOT public.rw_is_defect_output_grade(pe.grade_id)
 GROUP BY pe.entry_date, pe.shift, pe.department_id, d.name,
          pe.grade_id, g.code, pe.sub_department_id
HAVING public.rw_defect_qty_for_production(
         pe.entry_date, pe.shift, pe.department_id, pe.sub_department_id, pe.grade_id
       ) IS DISTINCT FROM SUM(COALESCE(pe.quantity_rejected, 0));

GRANT SELECT ON public.v_rw_posted_entry_conflicts TO anon, authenticated, service_role;

-- v_rw_entry_coverage, v_rw_output_reconciliation, v_rw_leaker_wip_reconciliation
-- and v_rw_posted_entry_conflicts never referenced products; they are already
-- correct on the new key and unchanged.

-- 5. Repost the surviving entries -------------------------------------------
-- The touch re-fires the posting trigger under the new functions, rebuilding
-- ledger rows, stock and the derived production figures on the grade key.
UPDATE public.rw_checker_entries SET entered_at = entered_at;
