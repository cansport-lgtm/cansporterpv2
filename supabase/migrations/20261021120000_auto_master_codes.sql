-- ============================================================
-- Auto-generated master codes
--
-- Every master-data record (items, suppliers, customers, products, spare
-- parts, machines, employees, assets, categories, locations, ...) now gets its
-- code from the database instead of being typed by hand.
--
-- How it works:
--   * auto_code_series holds one row per master table: which column holds the
--     code, the prefix and the minimum digit width of its series, and how the
--     prefix depends on a grouping column (item type, spare-part category, ...).
--   * A BEFORE INSERT trigger (trg_00_auto_code, named to run before the
--     table's other triggers) fills the code when the insert leaves it blank.
--     Inserts that supply a code (imports, mirrors, system-created rows) keep
--     it, so nothing that already sets codes changes behaviour.
--   * Each series continues from the highest number already used for its
--     prefix, so existing codes are never renumbered.
--   * auto_code_preview() lets the forms show the code a new record will get.
--     The trigger recomputes at insert time under an advisory lock, so two
--     users saving at once never receive the same code.
--
-- Group modes:
--   none          one series per table (prefix column).
--   fixed         prefix chosen from group_prefixes by the group value.
--   learned       prefix = the most common prefix already used by rows in the
--                 same group (e.g. spare parts in MECHANICAL use "MECH-");
--                 falls back to group_prefixes, then (if derive_from_group)
--                 the first 3 letters of the group, then the default prefix.
--   leading_digit like learned, but the prefix is the leading digit of
--                 4-digit codes (chart of accounts: 5xxx = expenses).
--
-- reuse_by_column: for tables holding several rows of the same thing (floor
-- inventory keeps one row per item per location), a new row reuses the code
-- already given to another row with the same value in that column.
-- ============================================================

-- 1) Series configuration.
CREATE TABLE IF NOT EXISTS public.auto_code_series (
  entity            text PRIMARY KEY,
  table_name        text NOT NULL,
  code_column       text NOT NULL DEFAULT 'code',
  prefix            text NOT NULL DEFAULT '',
  min_width         integer NOT NULL DEFAULT 3,
  group_column      text,
  group_mode        text NOT NULL DEFAULT 'none'
                    CHECK (group_mode IN ('none', 'fixed', 'learned', 'leading_digit')),
  group_prefixes    jsonb NOT NULL DEFAULT '{}'::jsonb,
  derive_from_group boolean NOT NULL DEFAULT false,
  -- Extra {table, column} pairs that share this number series.
  shared_series     jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Rows matching every key/value here are left alone (another trigger owns them).
  skip_if           jsonb NOT NULL DEFAULT '{}'::jsonb,
  lock_key          text,
  reuse_by_column   text
);

ALTER TABLE public.auto_code_series ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'auto_code_series'
                    AND policyname = 'Read auto_code_series') THEN
    CREATE POLICY "Read auto_code_series" ON public.auto_code_series FOR SELECT USING (true);
  END IF;
END;
$$;

-- 2) Next code for an entity (no locking; callers lock when inserting).
CREATE OR REPLACE FUNCTION public.auto_code_next(p_entity text, p_group text DEFAULT NULL, p_reuse text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg        public.auto_code_series%ROWTYPE;
  v_prefix   text;
  v_width    integer;
  v_regex    text;
  v_series   jsonb;
  v_part     jsonb;
  v_num      numeric;
  v_len      integer;
  v_max      numeric := 0;
  v_max_len  integer := 0;
  v_candidate text;
  v_taken    boolean;
BEGIN
  SELECT * INTO cfg FROM public.auto_code_series WHERE entity = p_entity;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No auto-code series configured for %', p_entity;
  END IF;

  -- Same thing already coded on another row: reuse that code.
  IF cfg.reuse_by_column IS NOT NULL AND NULLIF(btrim(p_reuse), '') IS NOT NULL THEN
    EXECUTE format(
      'SELECT btrim(%1$I::text) FROM public.%2$I
        WHERE lower(btrim(%3$I::text)) = lower(btrim($1)) AND NULLIF(btrim(%1$I::text), '''') IS NOT NULL
        LIMIT 1',
      cfg.code_column, cfg.table_name, cfg.reuse_by_column)
    INTO v_candidate USING p_reuse;
    IF v_candidate IS NOT NULL THEN
      RETURN v_candidate;
    END IF;
  END IF;

  v_prefix := NULL;
  v_width := cfg.min_width;

  IF cfg.group_column IS NOT NULL AND NULLIF(btrim(p_group), '') IS NOT NULL THEN
    IF cfg.group_mode = 'learned' THEN
      EXECUTE format(
        'SELECT p FROM (
           SELECT regexp_replace(btrim(%1$I::text), ''[0-9]+$'', '''') AS p
             FROM public.%2$I
            WHERE %3$I::text = $1 AND btrim(%1$I::text) ~ ''[^0-9][0-9]+$''
         ) s GROUP BY p ORDER BY count(*) DESC, p LIMIT 1',
        cfg.code_column, cfg.table_name, cfg.group_column)
      INTO v_prefix USING p_group;
    ELSIF cfg.group_mode = 'leading_digit' THEN
      EXECUTE format(
        'SELECT left(btrim(%1$I::text), 1) FROM public.%2$I
          WHERE %3$I::text = $1 AND btrim(%1$I::text) ~ ''^[0-9]{4}$''
          GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1',
        cfg.code_column, cfg.table_name, cfg.group_column)
      INTO v_prefix USING p_group;
    END IF;

    IF v_prefix IS NULL THEN
      v_prefix := cfg.group_prefixes ->> p_group;
    END IF;

    IF v_prefix IS NULL AND cfg.derive_from_group THEN
      v_prefix := NULLIF(upper(left(regexp_replace(p_group, '[^A-Za-z]', '', 'g'), 3)), '');
      IF v_prefix IS NOT NULL THEN
        v_prefix := v_prefix || '-';
      END IF;
    END IF;
  END IF;

  v_prefix := coalesce(v_prefix, cfg.prefix);

  -- Highest number already used with this prefix, across every table that
  -- shares the series.
  v_regex := '^' || regexp_replace(v_prefix, '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '([0-9]+)$';
  v_series := jsonb_build_array(jsonb_build_object('table', cfg.table_name, 'column', cfg.code_column))
              || cfg.shared_series;

  FOR v_part IN SELECT * FROM jsonb_array_elements(v_series) LOOP
    EXECUTE format(
      'SELECT (m[1])::numeric, length(m[1]) FROM (
         SELECT regexp_match(btrim(%1$I::text), $1) AS m FROM public.%2$I
       ) s WHERE m IS NOT NULL ORDER BY 1 DESC, 2 DESC LIMIT 1',
      v_part ->> 'column', v_part ->> 'table')
    INTO v_num, v_len USING v_regex;
    IF v_num IS NOT NULL AND v_num > v_max THEN
      v_max := v_num;
      v_max_len := v_len;
    END IF;
  END LOOP;

  v_width := greatest(v_width, v_max_len);

  -- Skip anything already taken (e.g. a code stored with stray spaces).
  LOOP
    v_max := v_max + 1;
    v_candidate := v_prefix || lpad(v_max::text, v_width, '0');
    v_taken := false;
    FOR v_part IN SELECT * FROM jsonb_array_elements(v_series) LOOP
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%2$I WHERE upper(btrim(%1$I::text)) = upper($1))',
                     v_part ->> 'column', v_part ->> 'table')
        INTO v_taken USING v_candidate;
      EXIT WHEN v_taken;
    END LOOP;
    EXIT WHEN NOT v_taken;
  END LOOP;

  RETURN v_candidate;
END;
$$;

-- 3) Preview for the forms.
CREATE OR REPLACE FUNCTION public.auto_code_preview(p_entity text, p_group text DEFAULT NULL, p_reuse text DEFAULT NULL)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.auto_code_next(p_entity, p_group, p_reuse);
$$;

GRANT EXECUTE ON FUNCTION public.auto_code_preview(text, text, text) TO anon, authenticated;

-- 4) Trigger: fill the code on insert when it was left blank.
--    TG_ARGV[0] is the entity key in auto_code_series.
CREATE OR REPLACE FUNCTION public.auto_code_assign()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg     public.auto_code_series%ROWTYPE;
  v_row   jsonb := to_jsonb(NEW);
  v_skip  record;
  v_code  text;
BEGIN
  SELECT * INTO cfg FROM public.auto_code_series WHERE entity = TG_ARGV[0];
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NULLIF(btrim(v_row ->> cfg.code_column), '') IS NOT NULL THEN
    RETURN NEW;
  END IF;

  FOR v_skip IN SELECT key, value FROM jsonb_each_text(cfg.skip_if) LOOP
    IF v_row ->> v_skip.key IS NOT DISTINCT FROM v_skip.value THEN
      RETURN NEW;
    END IF;
  END LOOP;

  -- Serialise generation for the series so concurrent inserts never collide.
  PERFORM pg_advisory_xact_lock(hashtext('auto_code:' || coalesce(cfg.lock_key, cfg.entity)));

  v_code := public.auto_code_next(
    cfg.entity,
    CASE WHEN cfg.group_column IS NOT NULL THEN v_row ->> cfg.group_column END,
    CASE WHEN cfg.reuse_by_column IS NOT NULL THEN v_row ->> cfg.reuse_by_column END);

  NEW := jsonb_populate_record(NEW, jsonb_build_object(cfg.code_column, v_code));
  RETURN NEW;
END;
$$;

-- 5) The series. Existing patterns are continued; small lookup masters that
--    used free-form short codes start a numbered series of their own.
INSERT INTO public.auto_code_series
  (entity, table_name, code_column, prefix, min_width, group_column, group_mode, group_prefixes, derive_from_group, shared_series, skip_if, lock_key)
VALUES
  -- Items: one series per item type (RM173, OS-002, ...).
  ('items', 'items', 'code', 'ITM-', 3, 'category', 'fixed',
     '{"raw_material":"RM","office_supplies":"OS-","general_supplies":"PS-","spare_maintenance":"SP-"}', false, '[]', '{}', NULL),
  ('suppliers', 'suppliers', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('customers', 'customers', 'code', 'CUS-', 4, NULL, 'none', '{}', false, '[]', '{}', NULL),
  -- Own products only; customer SKUs keep their <customer>-NNN codes.
  ('products', 'products', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{"owner_type":"customer"}', NULL),
  ('spare_parts', 'spare_parts', 'code', 'SPR-', 3, 'category', 'learned', '{}', true, '[]', '{}', NULL),
  ('machines', 'machines', 'code', 'MCH-', 4, NULL, 'none', '{}', false, '[]', '{}', NULL),
  -- HR employees and labour share one badge-number series.
  ('employees', 'employees', 'employee_code', '', 3, NULL, 'none', '{}', false,
     '[{"table":"labour_employees","column":"employee_code"}]', '{}', 'employee_code'),
  ('labour_employees', 'labour_employees', 'employee_code', '', 3, NULL, 'none', '{}', false,
     '[{"table":"employees","column":"employee_code"}]', '{}', 'employee_code'),
  ('fixed_assets', 'fixed_assets', 'asset_code', 'FA-', 3, 'category', 'learned',
     '{"production_machinery":"MCH-","office_assets":"AO-","machine_spare_parts":"MSP-"}', true, '[]', '{}', NULL),
  ('planning_items', 'planning_items', 'code', 'PI-', 2, 'department_id', 'learned', '{}', false, '[]', '{}', NULL),
  ('consumption_products', 'consumption_products', 'code', 'SP', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('consumption_categories', 'consumption_categories', 'code', 'CAT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('consumption_subcategories', 'consumption_subcategories', 'code', 'SUB-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('hp_materials', 'hp_materials', 'code', 'HPM-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('online_items', 'online_items', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('online_platforms', 'online_platforms', 'code', 'PLT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('distributors', 'distributors', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('distributor_products', 'distributor_products', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('distributor_customers', 'distributor_customers', 'code', '', 2, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('accounting_parties', 'accounting_parties', 'code', 'PTY-', 4, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('accounting_chart_of_accounts', 'accounting_chart_of_accounts', 'code', '9', 3, 'account_type', 'leading_digit',
     '{"asset":"1","liability":"2","equity":"3","revenue":"4","expense":"5"}', false, '[]', '{}', NULL),
  ('production_departments', 'production_departments', 'code', 'DEPT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('production_sub_departments', 'production_sub_departments', 'code', 'SDEPT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('grades', 'grades', 'code', 'GRD-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('inventory_locations', 'inventory_locations', 'code', 'LOC-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('floor_inventory_locations', 'floor_inventory_locations', 'code', 'FLOC-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('floor_inventory_stock', 'floor_inventory_stock', 'item_code', 'FI-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('rw_locations', 'rw_locations', 'code', 'RWL-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('rw_defect_grades', 'rw_defect_grades', 'code', 'RDG-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('expense_categories', 'expense_categories', 'code', 'EXP-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('fixed_asset_categories', 'fixed_asset_categories', 'code', 'FAC-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('five_s_departments', 'five_s_departments', 'code', '5S-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('hourly_loss_reasons', 'hourly_loss_reasons', 'code', 'HLR-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('defect_reasons', 'defect_reasons', 'code', 'DFR-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('downtime_reasons', 'downtime_reasons', 'code', 'DTR-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('scrap_reasons', 'scrap_reasons', 'code', 'SCR-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('labour_categories', 'labour_categories', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('qa_processes', 'qa_processes', 'code', '', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('machine_monitor_machines', 'machine_monitor_machines', 'code', 'MM-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('performance_monthly_kpis', 'performance_monthly_kpis', 'code', 'MKPI-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('leave_types', 'leave_types', 'code', 'LT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('maintenance_types', 'maintenance_types', 'code', 'MT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL),
  ('utility_types', 'utility_types', 'code', 'UT-', 3, NULL, 'none', '{}', false, '[]', '{}', NULL)
ON CONFLICT (entity) DO NOTHING;

-- Floor inventory keeps one row per item per location: an item keeps one code.
UPDATE public.auto_code_series SET reuse_by_column = 'item_name' WHERE entity = 'floor_inventory_stock';

-- 6) Attach the trigger to every configured table.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT entity, table_name FROM public.auto_code_series LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER trg_00_auto_code BEFORE INSERT ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.auto_code_assign(%L)',
      r.table_name, r.entity);
  END LOOP;
END;
$$;
