-- ============================================================================
-- Store Pass — Step 2: daily store ↔ gate reconciliation, gate check notice,
-- daily discrepancy notification
-- ----------------------------------------------------------------------------
-- Builds on 20261008120100_store_pass.sql (v_store_gate_tracking).
--
--   * store_pass_reconcile(from, to): one row per domestic dispatch that
--     belongs to the day(s) — dated in it, store-issued in it, gone out of the
--     gate in it, or whose issued store pass was cancelled in it — with the
--     dispatch (DC), store pass (SP) and gate pass (GP) figures and the
--     discrepancy codes found:
--
--       OUT_NO_SP                 went out of the gate with no issued store pass   high
--       SP_NOT_OUT                issued by the store, not out of the gate          high
--       SP_VS_GP                  store issued ≠ counted at the gate                high
--       SP_VS_DC                  store issued ≠ the dispatch as it is now          medium
--       DC_CHANGED                dispatch edited after the store pass was issued   medium
--       SP_CANCELLED_AFTER_ISSUE  an issued store pass was cancelled                info
--       CROSS_DAY                 issued on one day, out on another                 info
--       DC_PENDING                dispatch made, nothing issued or out yet          info
--
--     A manager (store pass manager, gate pass manager, super admin) can mark a
--     code on a dispatch Explained with a note (store_pass_recon_notes); it then
--     counts as closed. store_pass_reconcile_products gives the same day(s)
--     per product, for checking the FG store.
--
--   * Gate check: when a SALES gate pass is checked and one of its domestic
--     dispatches has no issued store pass, store_pass_settings.required_at_gate
--     decides: off → nothing; warn (default) → the vehicle may go, the event
--     'no_store_pass' is logged on the gate pass and the store pass managers
--     are notified; block → the check is refused until a store pass is issued.
--     store_pass_gate_status(gate_pass_id) tells the Gate Check page up front.
--
--   * Every day at 20:30 Pakistan time, store pass managers and gate pass
--     managers get one notification with the day's open high discrepancies.
--
-- Rollback: supabase/rollbacks/20261008120200_store_pass_reconciliation_down.sql
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.store_pass_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  required_at_gate text NOT NULL DEFAULT 'warn' CHECK (required_at_gate IN ('off','warn','block')),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.store_pass_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- A discrepancy a manager has looked at and explained. One note per dispatch
-- and code; reopening deletes it.
CREATE TABLE IF NOT EXISTS public.store_pass_recon_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_id uuid NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE CASCADE,
  discrepancy_code text NOT NULL,
  note text NOT NULL CHECK (length(btrim(note)) > 0),
  resolved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_pass_recon_notes_uk UNIQUE (dispatch_id, discrepancy_code)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['store_pass_settings','store_pass_recon_notes'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role;', t);
  END LOOP;
END $$;

-- 2. Helpers -----------------------------------------------------------------

-- Factory-day of a timestamp (the reconciliation is per Pakistan day).
CREATE OR REPLACE FUNCTION public.store_pass_pk_date(p timestamptz)
RETURNS date LANGUAGE sql IMMUTABLE
AS $$ SELECT (p AT TIME ZONE 'Asia/Karachi')::date; $$;

CREATE OR REPLACE FUNCTION public.store_pass_code_severity(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_code
    WHEN 'OUT_NO_SP' THEN 'high' WHEN 'SP_NOT_OUT' THEN 'high' WHEN 'SP_VS_GP' THEN 'high'
    WHEN 'SP_VS_DC' THEN 'medium' WHEN 'DC_CHANGED' THEN 'medium'
    ELSE 'info' END;
$$;

-- Who may explain discrepancies: the store side and the gate side.
CREATE OR REPLACE FUNCTION public.store_pass_recon_can()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT public.store_pass_has_any_role(ARRAY['super_admin','store_pass_manager','gate_pass_manager']); $$;

-- The dispatches that belong to a day range: dated in it, store-issued in it,
-- out of the gate in it, or whose issued store pass was cancelled in it.
CREATE OR REPLACE FUNCTION public.store_pass_recon_dispatch_ids(p_from date, p_to date)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT t.dispatch_id
    FROM public.v_store_gate_tracking t
   WHERE t.dispatch_date BETWEEN p_from AND p_to
      OR public.store_pass_pk_date(t.sp_issued_at) BETWEEN p_from AND p_to
      OR public.store_pass_pk_date(t.gate_out_at) BETWEEN p_from AND p_to
  UNION
  SELECT spd.dispatch_id
    FROM public.store_pass_dispatches spd
    JOIN public.store_passes sp ON sp.id = spd.store_pass_id
    JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
   WHERE sp.status = 'cancelled' AND sp.issued_at IS NOT NULL
     AND sd.sales_segment = 'domestic'
     AND public.store_pass_pk_date(sp.cancelled_at) BETWEEN p_from AND p_to;
$$;

-- 3. Reconciliation ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_pass_reconcile(p_from date, p_to date)
RETURNS TABLE (
  dispatch_id uuid, dispatch_number text, dispatch_date date, dispatch_created_at timestamptz,
  delivery_status text, customer_name text, order_numbers text,
  dc_quantity numeric, dc_packages numeric,
  store_pass_id uuid, sp_number text, sp_status text, sp_issued_at timestamptz, sp_date date,
  sp_quantity numeric, sp_packages numeric, sp_dispatch_quantity numeric, sp_dispatch_packages numeric,
  gate_pass_id uuid, gp_number text, gp_status text, gp_held_at timestamptz, gate_out_at timestamptz, out_date date,
  gp_quantity numeric, gp_packages numeric, gp_counted_packages numeric, gp_counted_quantity numeric,
  stage text,
  cancelled_sp_number text, cancelled_sp_reason text, cancelled_sp_at timestamptz,
  codes text[], high_codes integer, open_high integer, open_medium integer,
  explained jsonb
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT t.*,
           public.store_pass_pk_date(t.sp_issued_at) AS sp_date,
           public.store_pass_pk_date(t.gate_out_at) AS out_date,
           c.pass_number AS cancelled_sp_number, c.cancel_reason AS cancelled_sp_reason, c.cancelled_at AS cancelled_sp_at
      FROM public.v_store_gate_tracking t
      LEFT JOIN LATERAL (
        SELECT sp.pass_number, sp.cancel_reason, sp.cancelled_at
          FROM public.store_pass_dispatches spd
          JOIN public.store_passes sp ON sp.id = spd.store_pass_id
         WHERE spd.dispatch_id = t.dispatch_id AND sp.status = 'cancelled' AND sp.issued_at IS NOT NULL
           AND public.store_pass_pk_date(sp.cancelled_at) BETWEEN p_from AND p_to
         ORDER BY sp.cancelled_at DESC LIMIT 1
      ) c ON true
     WHERE t.dispatch_id IN (SELECT public.store_pass_recon_dispatch_ids(p_from, p_to))
  ),
  coded AS (
    SELECT b.*,
           ARRAY_REMOVE(ARRAY[
             CASE WHEN b.gate_out_at IS NOT NULL AND b.sp_status IS DISTINCT FROM 'issued' THEN 'OUT_NO_SP' END,
             CASE WHEN b.sp_status = 'issued' AND b.stage IN ('issued','on_gate_pass','held') THEN 'SP_NOT_OUT' END,
             CASE WHEN b.sp_status = 'issued' AND b.gate_out_at IS NOT NULL AND (
                    CASE WHEN COALESCE(b.gp_counted_packages, b.gp_packages) IS NOT NULL AND b.sp_packages IS NOT NULL
                         THEN COALESCE(b.gp_counted_packages, b.gp_packages) <> b.sp_packages
                         ELSE COALESCE(b.gp_counted_quantity, b.gp_quantity) IS DISTINCT FROM b.sp_quantity END)
                  THEN 'SP_VS_GP' END,
             CASE WHEN b.sp_status = 'issued' AND (b.sp_quantity <> b.dc_quantity OR COALESCE(b.sp_packages, 0) <> b.dc_packages) THEN 'SP_VS_DC' END,
             CASE WHEN b.sp_status = 'issued' AND (b.sp_dispatch_quantity <> b.dc_quantity OR COALESCE(b.sp_dispatch_packages, 0) <> b.dc_packages) THEN 'DC_CHANGED' END,
             CASE WHEN b.cancelled_sp_number IS NOT NULL THEN 'SP_CANCELLED_AFTER_ISSUE' END,
             CASE WHEN b.sp_date IS NOT NULL AND b.out_date IS NOT NULL AND b.sp_date <> b.out_date THEN 'CROSS_DAY' END,
             CASE WHEN b.stage IN ('no_store_pass','draft') AND b.delivery_status = 'pending' THEN 'DC_PENDING' END
           ]::text[], NULL) AS codes
      FROM base b
  )
  SELECT c.dispatch_id, c.dispatch_number, c.dispatch_date, c.dispatch_created_at,
         c.delivery_status, c.customer_name, c.order_numbers,
         c.dc_quantity, c.dc_packages,
         c.store_pass_id, c.sp_number, c.sp_status, c.sp_issued_at, c.sp_date,
         c.sp_quantity, c.sp_packages, c.sp_dispatch_quantity, c.sp_dispatch_packages,
         c.gate_pass_id, c.gp_number, c.gp_status, c.gp_held_at, c.gate_out_at, c.out_date,
         c.gp_quantity, c.gp_packages, c.gp_counted_packages, c.gp_counted_quantity,
         c.stage,
         c.cancelled_sp_number, c.cancelled_sp_reason, c.cancelled_sp_at,
         c.codes,
         (SELECT count(*) FROM unnest(c.codes) x WHERE public.store_pass_code_severity(x) = 'high')::integer,
         (SELECT count(*) FROM unnest(c.codes) x
           WHERE public.store_pass_code_severity(x) = 'high'
             AND NOT EXISTS (SELECT 1 FROM public.store_pass_recon_notes n WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = x))::integer,
         (SELECT count(*) FROM unnest(c.codes) x
           WHERE public.store_pass_code_severity(x) = 'medium'
             AND NOT EXISTS (SELECT 1 FROM public.store_pass_recon_notes n WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = x))::integer,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('code', n.discrepancy_code, 'note', n.note,
                                                       'by', u.full_name, 'at', n.resolved_at) ORDER BY n.resolved_at)
                     FROM public.store_pass_recon_notes n
                     LEFT JOIN public.app_users u ON u.id = n.resolved_by
                    WHERE n.dispatch_id = c.dispatch_id AND n.discrepancy_code = ANY (c.codes)), '[]'::jsonb)
    FROM coded c
   ORDER BY c.dispatch_number;
$$;

-- The same day(s) per product: what each SKU should have lost from the store.
CREATE OR REPLACE FUNCTION public.store_pass_reconcile_products(p_from date, p_to date)
RETURNS TABLE (
  product_id uuid, product_code text, product_name text,
  dc_quantity numeric, dc_packages numeric,
  sp_quantity numeric, sp_packages numeric,
  gp_quantity numeric, gp_packages numeric, gp_counted_packages numeric, gp_counted_quantity numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH ids AS (SELECT public.store_pass_recon_dispatch_ids(p_from, p_to) AS dispatch_id),
  dc AS (
    SELECT oi.product_id, sum(di.quantity_dozens) AS q, sum(COALESCE(di.packages, 0)) AS p
      FROM public.sales_dispatch_items di
      JOIN public.sales_order_items oi ON oi.id = di.order_item_id
     WHERE di.dispatch_id IN (SELECT dispatch_id FROM ids)
     GROUP BY oi.product_id
  ),
  sp AS (
    SELECT i.product_id, sum(i.quantity) AS q, sum(COALESCE(i.packages, 0)) AS p
      FROM public.store_pass_items i
      JOIN public.store_passes s ON s.id = i.store_pass_id
     WHERE s.status = 'issued' AND i.dispatch_id IN (SELECT dispatch_id FROM ids)
     GROUP BY i.product_id
  ),
  gp AS (
    SELECT i.product_id, sum(i.quantity) AS q, sum(COALESCE(i.packages, 0)) AS p,
           sum(i.counted) FILTER (WHERE i.count_basis = 'packages') AS cp,
           sum(i.counted) FILTER (WHERE i.count_basis = 'quantity') AS cq
      FROM public.gate_pass_items i
      JOIN public.gate_passes g ON g.id = i.gate_pass_id
     WHERE g.gate_out_at IS NOT NULL AND g.status NOT IN ('cancelled','rejected')
       AND i.dispatch_id IN (SELECT dispatch_id FROM ids)
     GROUP BY i.product_id
  ),
  all_products AS (
    SELECT product_id FROM dc UNION SELECT product_id FROM sp UNION SELECT product_id FROM gp
  )
  SELECT a.product_id, p.code, p.name,
         COALESCE(dc.q, 0), COALESCE(dc.p, 0),
         COALESCE(sp.q, 0), COALESCE(sp.p, 0),
         COALESCE(gp.q, 0), COALESCE(gp.p, 0), gp.cp, gp.cq
    FROM all_products a
    LEFT JOIN public.products p ON p.id = a.product_id
    LEFT JOIN dc ON dc.product_id = a.product_id
    LEFT JOIN sp ON sp.product_id = a.product_id
    LEFT JOIN gp ON gp.product_id = a.product_id
   ORDER BY p.code NULLS LAST;
$$;

-- A manager explains a discrepancy (or reopens it).
CREATE OR REPLACE FUNCTION public.store_pass_recon_resolve(p_dispatch_id uuid, p_code text, p_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.store_pass_recon_can() THEN
    RAISE EXCEPTION 'Only a store pass manager or a gate pass manager can explain a discrepancy.';
  END IF;
  IF p_code NOT IN ('OUT_NO_SP','SP_NOT_OUT','SP_VS_GP','SP_VS_DC','DC_CHANGED','SP_CANCELLED_AFTER_ISSUE','CROSS_DAY','DC_PENDING') THEN
    RAISE EXCEPTION 'Unknown discrepancy code %.', p_code;
  END IF;
  IF NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Write what explains this discrepancy.';
  END IF;
  INSERT INTO public.store_pass_recon_notes (dispatch_id, discrepancy_code, note, resolved_by, resolved_at)
  VALUES (p_dispatch_id, p_code, btrim(p_note), public.app_user_id(), now())
  ON CONFLICT (dispatch_id, discrepancy_code)
  DO UPDATE SET note = EXCLUDED.note, resolved_by = EXCLUDED.resolved_by, resolved_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.store_pass_recon_reopen(p_dispatch_id uuid, p_code text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.store_pass_recon_can() THEN
    RAISE EXCEPTION 'Only a store pass manager or a gate pass manager can reopen a discrepancy.';
  END IF;
  DELETE FROM public.store_pass_recon_notes WHERE dispatch_id = p_dispatch_id AND discrepancy_code = p_code;
END;
$$;

-- 4. Settings ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_pass_settings_save(p_required_at_gate text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.store_pass_has_any_role(ARRAY['super_admin']) THEN
    RAISE EXCEPTION 'Only a super admin can change the store pass settings.';
  END IF;
  IF p_required_at_gate NOT IN ('off','warn','block') THEN
    RAISE EXCEPTION 'The gate setting must be off, warn or block.';
  END IF;
  UPDATE public.store_pass_settings
     SET required_at_gate = p_required_at_gate, updated_by = public.app_user_id(), updated_at = now()
   WHERE id;
END;
$$;

-- 5. Gate check hook ---------------------------------------------------------

-- Domestic dispatches on a sales gate pass that have no issued store pass.
CREATE OR REPLACE FUNCTION public.store_pass_missing_for_gate_pass(p_gate_pass_id uuid)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT array_agg(sd.dispatch_number ORDER BY sd.dispatch_number)
    FROM public.gate_pass_dispatches gd
    JOIN public.sales_dispatches sd ON sd.id = gd.dispatch_id
   WHERE gd.gate_pass_id = p_gate_pass_id
     AND sd.sales_segment = 'domestic'
     AND NOT EXISTS (SELECT 1 FROM public.v_dispatch_store_pass v
                      WHERE v.dispatch_id = sd.id AND v.status = 'issued');
$$;

-- For the Gate Check page, before the guard counts: { mode, missing: [DC-…] }.
CREATE OR REPLACE FUNCTION public.store_pass_gate_status(p_gate_pass_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_mode text;
  v_missing text[];
BEGIN
  IF NOT public.gate_pass_can('gate') AND NOT public.store_pass_has_any_role(ARRAY['gate_pass_officer','gate_pass_viewer']) THEN
    RAISE EXCEPTION 'Only gate security or a gate pass user can read this.';
  END IF;
  SELECT required_at_gate INTO v_mode FROM public.store_pass_settings WHERE id;
  IF NOT EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_gate_pass_id AND pass_type = 'sales') THEN
    RETURN jsonb_build_object('mode', COALESCE(v_mode, 'warn'), 'missing', '[]'::jsonb);
  END IF;
  v_missing := public.store_pass_missing_for_gate_pass(p_gate_pass_id);
  RETURN jsonb_build_object('mode', COALESCE(v_mode, 'warn'), 'missing', COALESCE(to_jsonb(v_missing), '[]'::jsonb));
END;
$$;

-- Wrap the gate check again (Phase 2/3 wrapped it for scrap): a sales pass
-- with a domestic dispatch that has no issued store pass is refused in
-- 'block' mode; in 'warn' mode it goes out, is logged and the store managers
-- are told. Counting, holding and releasing are unchanged.
CREATE OR REPLACE FUNCTION public.gate_pass_gate_check(
  p_id uuid, p_counts jsonb, p_vehicle text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  g public.gate_passes%ROWTYPE;
  v_mode text := 'warn';
  v_missing text[];
  v_res jsonb;
  v_uid uuid := public.app_user_id();
BEGIN
  SELECT * INTO g FROM public.gate_passes WHERE id = p_id;
  IF FOUND AND g.pass_type = 'scrap' THEN
    RAISE EXCEPTION 'A scrap pass is weighed at the gate, not counted.';
  END IF;
  IF FOUND AND g.pass_type = 'sales' THEN
    SELECT required_at_gate INTO v_mode FROM public.store_pass_settings WHERE id;
    v_mode := COALESCE(v_mode, 'warn');
    IF v_mode <> 'off' THEN
      v_missing := public.store_pass_missing_for_gate_pass(p_id);
    END IF;
    IF v_missing IS NOT NULL AND v_mode = 'block' THEN
      RAISE EXCEPTION 'No store pass for dispatch %. The store must issue a store pass before this vehicle can leave.',
        array_to_string(v_missing, ', ');
    END IF;
  END IF;

  v_res := public.gate_pass_gate_check_count(p_id, p_counts, p_vehicle, p_note);

  IF v_missing IS NOT NULL AND v_mode = 'warn' AND v_res->>'status' = 'out' THEN
    PERFORM public.gate_pass_log(p_id, 'no_store_pass',
      'Went out with no store pass for ' || array_to_string(v_missing, ', '),
      jsonb_build_object('dispatches', v_missing));
    PERFORM public.notify_role(ARRAY['super_admin','store_pass_manager']::app_role[],
      'Vehicle out with no store pass',
      g.pass_number || ' (' || g.party_name || COALESCE(', ' || g.vehicle_number, '') || ') left the gate with no store pass for '
        || array_to_string(v_missing, ', '),
      'warning', 'store_pass', '/store-pass/tracking', 'gate_pass', g.id, v_uid, v_uid);
    v_res := v_res || jsonb_build_object('missing_store_pass', to_jsonb(v_missing));
  END IF;
  RETURN v_res;
END;
$$;

-- 6. Daily notification ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.store_pass_notify_discrepancies()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Karachi')::date;
  v_rows integer;
  v_out_no_sp integer;
  v_not_out integer;
  v_sp_vs_gp integer;
BEGIN
  SELECT count(*),
         count(*) FILTER (WHERE 'OUT_NO_SP' = ANY (r.codes)),
         count(*) FILTER (WHERE 'SP_NOT_OUT' = ANY (r.codes)),
         count(*) FILTER (WHERE 'SP_VS_GP' = ANY (r.codes))
    INTO v_rows, v_out_no_sp, v_not_out, v_sp_vs_gp
    FROM public.store_pass_reconcile(v_today, v_today) r
   WHERE r.open_high > 0;
  IF v_rows = 0 THEN
    RETURN 0;
  END IF;
  PERFORM public.notify_role(ARRAY['super_admin','store_pass_manager','gate_pass_manager']::app_role[],
    'Store ↔ gate discrepancies today',
    v_rows || ' dispatch(es) on ' || to_char(v_today, 'DD Mon') || ' need a look: '
      || v_out_no_sp || ' out with no store pass, ' || v_not_out || ' issued but not out, '
      || v_sp_vs_gp || ' store ≠ gate count.',
    'warning', 'store_pass', '/store-pass/reconciliation?date=' || to_char(v_today, 'YYYY-MM-DD'),
    'store_pass_reconciliation', NULL, NULL, NULL);
  RETURN v_rows;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'store-pass-discrepancies';
    -- 15:30 UTC = 20:30 in Pakistan.
    PERFORM cron.schedule('store-pass-discrepancies', '30 15 * * *', 'SELECT public.store_pass_notify_discrepancies()');
  END IF;
END $$;

-- 7. Grants ------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.store_pass_pk_date(timestamptz),
  public.store_pass_code_severity(text),
  public.store_pass_recon_can(),
  public.store_pass_reconcile(date, date),
  public.store_pass_reconcile_products(date, date),
  public.store_pass_recon_resolve(uuid, text, text),
  public.store_pass_recon_reopen(uuid, text),
  public.store_pass_settings_save(text),
  public.store_pass_gate_status(uuid),
  public.gate_pass_gate_check(uuid, jsonb, text, text)
TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION
  public.store_pass_recon_dispatch_ids(date, date),
  public.store_pass_missing_for_gate_pass(uuid),
  public.store_pass_notify_discrepancies()
FROM PUBLIC, anon, authenticated;
