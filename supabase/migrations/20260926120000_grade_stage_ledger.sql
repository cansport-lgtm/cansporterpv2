-- ============================================================================
-- Grade-wise stage ledger: Coly → Jorr → Ball
-- ----------------------------------------------------------------------------
-- Tracks, per grade, the stock sitting between production stages:
--
--   COLY  in:  Press entries (OK)          out: Jorr entries (OK + rejected)
--   JORR  in:  Jorr entries (OK)           out: Local Final + Fancy Final
--                                               entries (OK + rejected)
--   BALL  in:  Local/Fancy Final (OK)      out: transfers to packing
--
-- Every step is 1 bag in → 1 bag out of the same grade. Rejected output still
-- used up its input, so consumption is OK + rejected.
--
-- The ledger is derived, not stored: v_grade_ledger_movements unions the
-- posted production entries with the ledger's own documents (opening
-- balances, super-admin adjustments, approved regrades, packing transfers).
-- Nothing is written into production_entries and no trigger is added to it,
-- so the existing WIP ledger / WIP tracking pages are untouched. Unposting or
-- editing an entry is reflected immediately with no reversal bookkeeping.
--
-- Only posted entries dated on/after the cutover date count. Until a super
-- admin saves the cutover date (1 Sep or 1 Oct 2026) the ledger is empty.
--
-- Writes to the ledger's own tables go only through the SECURITY DEFINER
-- functions below, which check the acting user's role via app_user_id():
--   * settings / opening balances / adjustments / regrade approval: super_admin
--   * regrade requests: manager, operational_manager (and super_admin)
--   * packing transfers: production 'create' permission (and super_admin)
-- ============================================================================

-- 1. Tables ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.grade_ledger_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cutover_date date NOT NULL CHECK (cutover_date IN (DATE '2026-09-01', DATE '2026-10-01')),
  -- Negative stock only warns before this date; from it on, it blocks.
  block_negative_from date NOT NULL,
  opening_locked boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.grade_ledger_openings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket text NOT NULL CHECK (bucket IN ('COLY','JORR','BALL')),
  grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity >= 0),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grade_ledger_openings_uk UNIQUE (bucket, grade_id)
);

CREATE TABLE IF NOT EXISTS public.grade_ledger_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('COLY','JORR','BALL')),
  grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity <> 0),  -- + adds stock, − removes it
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grade_ledger_adjustments_idx
  ON public.grade_ledger_adjustments (bucket, grade_id, txn_date);

CREATE SEQUENCE IF NOT EXISTS public.grade_regrade_request_seq;

CREATE TABLE IF NOT EXISTS public.grade_regrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text NOT NULL UNIQUE
    DEFAULT 'RG-' || lpad(nextval('public.grade_regrade_request_seq')::text, 5, '0'),
  txn_date date NOT NULL,
  bucket text NOT NULL CHECK (bucket IN ('COLY','JORR','BALL')),
  from_grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  to_grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  status text NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending','Approved','Rejected','Cancelled')),
  requested_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_remarks text,
  CONSTRAINT grade_regrade_requests_grades_ck CHECK (from_grade_id <> to_grade_id)
);
CREATE INDEX IF NOT EXISTS grade_regrade_requests_status_idx
  ON public.grade_regrade_requests (status, txn_date);

CREATE TABLE IF NOT EXISTS public.grade_packing_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL,
  grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  remarks text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grade_packing_transfers_idx
  ON public.grade_packing_transfers (grade_id, txn_date);

-- Read-only to clients: there are SELECT policies only, so every write has to
-- go through the role-checked functions below.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'grade_ledger_settings','grade_ledger_openings','grade_ledger_adjustments',
    'grade_regrade_requests','grade_packing_transfers'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Read %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Read %s" ON public.%I FOR SELECT TO public USING (true);', t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated, service_role;', t);
  END LOOP;
END $$;
GRANT ALL ON public.grade_ledger_settings, public.grade_ledger_openings,
  public.grade_ledger_adjustments, public.grade_regrade_requests,
  public.grade_packing_transfers TO service_role;

-- 2. Movements view ----------------------------------------------------------
-- One row per stock movement. sort_order keeps the opening first on the
-- cutover date and production IN ahead of consumption OUT within a day.

CREATE OR REPLACE VIEW public.v_grade_ledger_movements AS
WITH s AS (
  SELECT cutover_date FROM public.grade_ledger_settings WHERE id
),
pe AS (
  SELECT e.id, e.entry_date, e.grade_id, d.code AS dept_code,
         COALESCE(e.quantity_ok, 0) AS qty_ok,
         COALESCE(e.quantity_ok, 0) + COALESCE(e.quantity_rejected, 0) AS qty_used,
         e.remarks, e.created_by, e.created_at
    FROM public.production_entries e
    JOIN public.production_departments d ON d.id = e.department_id
    CROSS JOIN s
   WHERE e.status = 'Posted'
     AND e.entry_date >= s.cutover_date
     AND d.code IN ('PRESS','JORR','LOCAL_FINAL','FANCY_FINAL')
)
-- Opening balances, dated on the cutover date
SELECT 'opening:' || o.id::text AS movement_id, s.cutover_date AS txn_date,
       o.bucket, o.grade_id, o.quantity AS qty_in, 0::numeric AS qty_out,
       'opening'::text AS source_type, o.id AS source_id, NULL::text AS department_code,
       NULL::text AS reference, NULL::text AS remarks,
       o.updated_by AS created_by, o.created_at, 0 AS sort_order
  FROM public.grade_ledger_openings o CROSS JOIN s
 WHERE o.quantity <> 0
UNION ALL
-- Production output (OK) into the stage's own bucket
SELECT 'prod:' || pe.id::text, pe.entry_date,
       CASE pe.dept_code WHEN 'PRESS' THEN 'COLY' WHEN 'JORR' THEN 'JORR' ELSE 'BALL' END,
       pe.grade_id, pe.qty_ok, 0,
       'production', pe.id, pe.dept_code, NULL, pe.remarks, pe.created_by, pe.created_at, 1
  FROM pe
 WHERE pe.qty_ok <> 0
UNION ALL
-- Consumption (OK + rejected) out of the previous stage's bucket, same grade
SELECT 'cons:' || pe.id::text, pe.entry_date,
       CASE pe.dept_code WHEN 'JORR' THEN 'COLY' ELSE 'JORR' END,
       pe.grade_id, 0, pe.qty_used,
       'consumption', pe.id, pe.dept_code, NULL, pe.remarks, pe.created_by, pe.created_at, 2
  FROM pe
 WHERE pe.dept_code IN ('JORR','LOCAL_FINAL','FANCY_FINAL')
   AND pe.qty_used <> 0
UNION ALL
-- Super-admin adjustments
SELECT 'adj:' || a.id::text, a.txn_date, a.bucket, a.grade_id,
       GREATEST(a.quantity, 0), GREATEST(-a.quantity, 0),
       'adjustment', a.id, NULL, a.reference, a.reason, a.created_by, a.created_at, 3
  FROM public.grade_ledger_adjustments a CROSS JOIN s
 WHERE a.txn_date >= s.cutover_date
UNION ALL
-- Approved regrades: out of the old grade …
SELECT 'rgo:' || r.id::text, r.txn_date, r.bucket, r.from_grade_id, 0, r.quantity,
       'regrade_out', r.id, NULL, r.request_number, r.reason, r.requested_by,
       COALESCE(r.reviewed_at, r.requested_at), 3
  FROM public.grade_regrade_requests r CROSS JOIN s
 WHERE r.status = 'Approved' AND r.txn_date >= s.cutover_date
UNION ALL
-- … and into the new grade
SELECT 'rgi:' || r.id::text, r.txn_date, r.bucket, r.to_grade_id, r.quantity, 0,
       'regrade_in', r.id, NULL, r.request_number, r.reason, r.requested_by,
       COALESCE(r.reviewed_at, r.requested_at), 3
  FROM public.grade_regrade_requests r CROSS JOIN s
 WHERE r.status = 'Approved' AND r.txn_date >= s.cutover_date
UNION ALL
-- Ball bags handed over to packing
SELECT 'pack:' || p.id::text, p.txn_date, 'BALL', p.grade_id, 0, p.quantity,
       'packing_transfer', p.id, NULL, NULL, p.remarks, p.created_by, p.created_at, 4
  FROM public.grade_packing_transfers p CROSS JOIN s
 WHERE p.txn_date >= s.cutover_date;

GRANT SELECT ON public.v_grade_ledger_movements TO anon, authenticated, service_role;

-- 3. Read functions ----------------------------------------------------------

-- Movements in a period with a running balance per bucket + grade. The
-- balance carries everything before p_from, so the first row in the period
-- already shows the true stock.
CREATE OR REPLACE FUNCTION public.grade_ledger_movements(
  p_from date, p_to date, p_bucket text DEFAULT NULL, p_grade uuid DEFAULT NULL
) RETURNS TABLE (
  movement_id text, txn_date date, bucket text, grade_id uuid, grade_code text,
  qty_in numeric, qty_out numeric, balance numeric, source_type text,
  source_id uuid, department_code text, reference text, remarks text,
  entered_by text, created_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH m AS (
    SELECT v.*,
           SUM(v.qty_in - v.qty_out) OVER (
             PARTITION BY v.bucket, v.grade_id
             ORDER BY v.txn_date, v.sort_order, v.created_at, v.movement_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS bal
      FROM public.v_grade_ledger_movements v
     WHERE v.txn_date <= p_to
       AND (p_bucket IS NULL OR v.bucket = p_bucket)
       AND (p_grade IS NULL OR v.grade_id = p_grade)
  )
  SELECT m.movement_id, m.txn_date, m.bucket, m.grade_id, btrim(g.code),
         m.qty_in, m.qty_out, m.bal, m.source_type, m.source_id,
         m.department_code, m.reference, m.remarks, u.full_name, m.created_at
    FROM m
    JOIN public.grades g ON g.id = m.grade_id
    LEFT JOIN public.app_users u ON u.id = m.created_by
   WHERE m.txn_date >= p_from
   ORDER BY m.bucket, btrim(g.code), m.txn_date, m.sort_order, m.created_at, m.movement_id;
$$;

-- Grade × bucket summary for a period. Opening = everything before p_from
-- plus the cutover opening balance itself; the other columns are in-period.
CREATE OR REPLACE FUNCTION public.grade_ledger_summary(p_from date, p_to date)
RETURNS TABLE (
  bucket text, grade_id uuid, grade_code text, grade_name text,
  opening numeric, produced numeric, consumed numeric,
  regrade_in numeric, regrade_out numeric,
  adjustment_in numeric, adjustment_out numeric,
  packing_out numeric, closing numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH v AS (
    SELECT * FROM public.v_grade_ledger_movements WHERE txn_date <= p_to
  ),
  agg AS (
    SELECT v.bucket, v.grade_id,
      SUM(v.qty_in - v.qty_out) FILTER (WHERE v.txn_date < p_from OR v.source_type = 'opening') AS opening,
      SUM(v.qty_in)  FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'production')       AS produced,
      SUM(v.qty_out) FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'consumption')      AS consumed,
      SUM(v.qty_in)  FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'regrade_in')       AS regrade_in,
      SUM(v.qty_out) FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'regrade_out')      AS regrade_out,
      SUM(v.qty_in)  FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'adjustment')       AS adjustment_in,
      SUM(v.qty_out) FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'adjustment')       AS adjustment_out,
      SUM(v.qty_out) FILTER (WHERE v.txn_date >= p_from AND v.source_type = 'packing_transfer') AS packing_out,
      SUM(v.qty_in - v.qty_out) AS closing
    FROM v
    GROUP BY v.bucket, v.grade_id
  )
  SELECT a.bucket, a.grade_id, btrim(g.code), g.name,
         COALESCE(a.opening, 0), COALESCE(a.produced, 0), COALESCE(a.consumed, 0),
         COALESCE(a.regrade_in, 0), COALESCE(a.regrade_out, 0),
         COALESCE(a.adjustment_in, 0), COALESCE(a.adjustment_out, 0),
         COALESCE(a.packing_out, 0), COALESCE(a.closing, 0)
    FROM agg a
    JOIN public.grades g ON g.id = a.grade_id
   ORDER BY CASE a.bucket WHEN 'COLY' THEN 1 WHEN 'JORR' THEN 2 ELSE 3 END, btrim(g.code);
$$;

-- Posted balance of one bucket + grade at the end of p_as_of.
CREATE OR REPLACE FUNCTION public.grade_ledger_balance(p_bucket text, p_grade uuid, p_as_of date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(SUM(qty_in - qty_out), 0)
    FROM public.v_grade_ledger_movements
   WHERE bucket = p_bucket AND grade_id = p_grade AND txn_date <= p_as_of;
$$;

-- What a new production entry may consume: the posted balance, less what
-- other still-draft entries of the consuming stages already claim. Used by
-- Daily Entry for the stock hint and the negative-stock warning/block.
CREATE OR REPLACE FUNCTION public.grade_ledger_available(
  p_bucket text, p_grade uuid, p_as_of date, p_exclude_entry uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_set public.grade_ledger_settings%ROWTYPE;
  v_posted numeric;
  v_drafts numeric;
BEGIN
  SELECT * INTO v_set FROM public.grade_ledger_settings WHERE id;
  IF NOT FOUND OR p_as_of < v_set.cutover_date THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  v_posted := public.grade_ledger_balance(p_bucket, p_grade, p_as_of);

  SELECT COALESCE(SUM(COALESCE(e.quantity_ok, 0) + COALESCE(e.quantity_rejected, 0)), 0)
    INTO v_drafts
    FROM public.production_entries e
    JOIN public.production_departments d ON d.id = e.department_id
   WHERE COALESCE(e.status, 'Draft') <> 'Posted'
     AND e.grade_id = p_grade
     AND e.entry_date BETWEEN v_set.cutover_date AND p_as_of
     AND (p_exclude_entry IS NULL OR e.id <> p_exclude_entry)
     AND ((p_bucket = 'COLY' AND d.code = 'JORR')
       OR (p_bucket = 'JORR' AND d.code IN ('LOCAL_FINAL','FANCY_FINAL')));

  RETURN jsonb_build_object(
    'enabled', true,
    'posted_balance', v_posted,
    'pending_drafts', v_drafts,
    'available', v_posted - v_drafts,
    'block', p_as_of >= v_set.block_negative_from,
    'block_negative_from', v_set.block_negative_from
  );
END;
$$;

-- 4. Write functions ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grade_ledger_is_super_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(public.has_role(public.app_user_id(), 'super_admin'::app_role), false);
$$;

-- Raises when taking p_qty out of a bucket on p_date would leave it negative
-- once the blocking period has started. Before that the caller just gets the
-- resulting balance back and shows a warning.
CREATE OR REPLACE FUNCTION public.grade_ledger_check_out(
  p_bucket text, p_grade uuid, p_date date, p_qty numeric
) RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_set public.grade_ledger_settings%ROWTYPE;
  v_after numeric;
BEGIN
  SELECT * INTO v_set FROM public.grade_ledger_settings WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grade ledger is not set up yet. A super admin must set the cutover date first.';
  END IF;
  IF p_date < v_set.cutover_date THEN
    RAISE EXCEPTION 'Date % is before the grade ledger cutover date %.', p_date, v_set.cutover_date;
  END IF;
  v_after := public.grade_ledger_balance(p_bucket, p_grade, p_date) - p_qty;
  IF v_after < 0 AND p_date >= v_set.block_negative_from THEN
    RAISE EXCEPTION 'Not enough % stock for this grade on %: only % available.',
      p_bucket, p_date, v_after + p_qty;
  END IF;
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.grade_ledger_save_settings(
  p_cutover date, p_block_from date, p_opening_locked boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_old public.grade_ledger_settings%ROWTYPE;
BEGIN
  IF NOT public.grade_ledger_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can change grade ledger settings.';
  END IF;
  IF p_block_from IS NULL OR p_block_from < p_cutover THEN
    RAISE EXCEPTION 'The blocking date cannot be before the cutover date.';
  END IF;
  SELECT * INTO v_old FROM public.grade_ledger_settings WHERE id;
  IF FOUND AND v_old.opening_locked AND v_old.cutover_date <> p_cutover THEN
    RAISE EXCEPTION 'Opening balances are locked. Unlock them before changing the cutover date.';
  END IF;

  INSERT INTO public.grade_ledger_settings AS s
    (id, cutover_date, block_negative_from, opening_locked, updated_by, updated_at)
  VALUES (true, p_cutover, p_block_from, COALESCE(p_opening_locked, false), public.app_user_id(), now())
  ON CONFLICT (id) DO UPDATE
    SET cutover_date = EXCLUDED.cutover_date,
        block_negative_from = EXCLUDED.block_negative_from,
        opening_locked = EXCLUDED.opening_locked,
        updated_by = EXCLUDED.updated_by,
        updated_at = now();
END;
$$;

-- p_rows: [{ "bucket": "COLY", "grade_id": "...", "quantity": 12.5 }, ...]
-- A zero quantity removes that opening row.
CREATE OR REPLACE FUNCTION public.grade_ledger_save_openings(p_rows jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_qty numeric;
  v_n integer := 0;
  v_locked boolean;
BEGIN
  IF NOT public.grade_ledger_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can set opening balances.';
  END IF;
  SELECT opening_locked INTO v_locked FROM public.grade_ledger_settings WHERE id;
  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'Set the cutover date before entering opening balances.';
  END IF;
  IF v_locked THEN
    RAISE EXCEPTION 'Opening balances are locked. Use an adjustment to correct stock.';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb)) LOOP
    v_qty := COALESCE((v_row->>'quantity')::numeric, 0);
    IF v_qty < 0 THEN
      RAISE EXCEPTION 'Opening balances cannot be negative.';
    END IF;
    IF v_qty = 0 THEN
      DELETE FROM public.grade_ledger_openings
       WHERE bucket = v_row->>'bucket' AND grade_id = (v_row->>'grade_id')::uuid;
    ELSE
      INSERT INTO public.grade_ledger_openings AS o (bucket, grade_id, quantity, updated_by)
      VALUES (v_row->>'bucket', (v_row->>'grade_id')::uuid, v_qty, public.app_user_id())
      ON CONFLICT (bucket, grade_id) DO UPDATE
        SET quantity = EXCLUDED.quantity, updated_by = EXCLUDED.updated_by, updated_at = now();
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END;
$$;

-- Returns the balance after the adjustment.
CREATE OR REPLACE FUNCTION public.grade_ledger_add_adjustment(
  p_date date, p_bucket text, p_grade uuid, p_quantity numeric, p_reason text, p_reference text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_after numeric;
BEGIN
  IF NOT public.grade_ledger_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can post stock adjustments.';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero.';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every adjustment.';
  END IF;
  v_after := public.grade_ledger_check_out(p_bucket, p_grade, p_date, GREATEST(-p_quantity, 0))
             + GREATEST(p_quantity, 0);

  INSERT INTO public.grade_ledger_adjustments
    (txn_date, bucket, grade_id, quantity, reason, reference, created_by)
  VALUES (p_date, p_bucket, p_grade, p_quantity, btrim(p_reason), NULLIF(btrim(p_reference), ''),
          public.app_user_id());
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION public.grade_regrade_request(
  p_date date, p_bucket text, p_from_grade uuid, p_to_grade uuid, p_quantity numeric, p_reason text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_cutover date;
  v_id uuid;
BEGIN
  IF NOT (public.has_role(v_uid, 'manager'::app_role)
       OR public.has_role(v_uid, 'operational_manager'::app_role)
       OR public.has_role(v_uid, 'super_admin'::app_role)) THEN
    RAISE EXCEPTION 'Only a manager can request a regrade.';
  END IF;
  SELECT cutover_date INTO v_cutover FROM public.grade_ledger_settings WHERE id;
  IF v_cutover IS NULL THEN
    RAISE EXCEPTION 'Grade ledger is not set up yet.';
  END IF;
  IF p_date < v_cutover THEN
    RAISE EXCEPTION 'Date % is before the grade ledger cutover date %.', p_date, v_cutover;
  END IF;
  IF p_from_grade = p_to_grade THEN
    RAISE EXCEPTION 'The new grade must be different from the current grade.';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every regrade.';
  END IF;

  INSERT INTO public.grade_regrade_requests
    (txn_date, bucket, from_grade_id, to_grade_id, quantity, reason, requested_by)
  VALUES (p_date, p_bucket, p_from_grade, p_to_grade, p_quantity, btrim(p_reason), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Approve or reject a pending regrade. Approval checks the old grade's stock
-- the same way an adjustment does. Returns the old grade's balance after it.
CREATE OR REPLACE FUNCTION public.grade_regrade_review(
  p_id uuid, p_approve boolean, p_remarks text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.grade_regrade_requests%ROWTYPE;
  v_after numeric := NULL;
BEGIN
  IF NOT public.grade_ledger_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can approve or reject regrades.';
  END IF;
  SELECT * INTO r FROM public.grade_regrade_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Regrade request not found.';
  END IF;
  IF r.status <> 'Pending' THEN
    RAISE EXCEPTION 'This request is already %.', lower(r.status);
  END IF;
  IF p_approve THEN
    v_after := public.grade_ledger_check_out(r.bucket, r.from_grade_id, r.txn_date, r.quantity);
  ELSIF p_remarks IS NULL OR btrim(p_remarks) = '' THEN
    RAISE EXCEPTION 'Give a reason for rejecting the request.';
  END IF;

  UPDATE public.grade_regrade_requests
     SET status = CASE WHEN p_approve THEN 'Approved' ELSE 'Rejected' END,
         reviewed_by = public.app_user_id(),
         reviewed_at = now(),
         review_remarks = NULLIF(btrim(p_remarks), '')
   WHERE id = p_id;
  RETURN v_after;
END;
$$;

-- The requester (or a super admin) can withdraw a request still pending.
CREATE OR REPLACE FUNCTION public.grade_regrade_cancel(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r public.grade_regrade_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.grade_regrade_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Regrade request not found.';
  END IF;
  IF r.status <> 'Pending' THEN
    RAISE EXCEPTION 'Only a pending request can be cancelled.';
  END IF;
  IF r.requested_by IS DISTINCT FROM public.app_user_id() AND NOT public.grade_ledger_is_super_admin() THEN
    RAISE EXCEPTION 'Only the requester or a super admin can cancel this request.';
  END IF;
  UPDATE public.grade_regrade_requests
     SET status = 'Cancelled', reviewed_by = public.app_user_id(), reviewed_at = now()
   WHERE id = p_id;
END;
$$;

-- Returns the Ball balance after the transfer.
CREATE OR REPLACE FUNCTION public.grade_packing_transfer_add(
  p_date date, p_grade uuid, p_quantity numeric, p_remarks text DEFAULT NULL
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_after numeric;
BEGIN
  IF NOT (public.grade_ledger_is_super_admin()
       OR public.has_module_permission(v_uid, 'production', 'create')) THEN
    RAISE EXCEPTION 'You do not have permission to record packing transfers.';
  END IF;
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;
  v_after := public.grade_ledger_check_out('BALL', p_grade, p_date, p_quantity);

  INSERT INTO public.grade_packing_transfers (txn_date, grade_id, quantity, remarks, created_by)
  VALUES (p_date, p_grade, p_quantity, NULLIF(btrim(p_remarks), ''), v_uid);
  RETURN v_after;
END;
$$;

-- The person who entered a transfer can remove it the same day; a super admin
-- any time.
CREATE OR REPLACE FUNCTION public.grade_packing_transfer_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p public.grade_packing_transfers%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.grade_packing_transfers WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Packing transfer not found.';
  END IF;
  IF NOT (public.grade_ledger_is_super_admin()
       OR (p.created_by = public.app_user_id() AND p.created_at::date = CURRENT_DATE)) THEN
    RAISE EXCEPTION 'Only a super admin can delete this transfer.';
  END IF;
  DELETE FROM public.grade_packing_transfers WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.grade_ledger_movements(date, date, text, uuid),
  public.grade_ledger_summary(date, date),
  public.grade_ledger_balance(text, uuid, date),
  public.grade_ledger_available(text, uuid, date, uuid),
  public.grade_ledger_is_super_admin(),
  public.grade_ledger_check_out(text, uuid, date, numeric),
  public.grade_ledger_save_settings(date, date, boolean),
  public.grade_ledger_save_openings(jsonb),
  public.grade_ledger_add_adjustment(date, text, uuid, numeric, text, text),
  public.grade_regrade_request(date, text, uuid, uuid, numeric, text),
  public.grade_regrade_review(uuid, boolean, text),
  public.grade_regrade_cancel(uuid),
  public.grade_packing_transfer_add(date, uuid, numeric, text),
  public.grade_packing_transfer_delete(uuid)
TO anon, authenticated, service_role;
