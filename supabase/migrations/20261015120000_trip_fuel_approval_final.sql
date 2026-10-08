-- ============================================================================
-- Staff trip fuel: HR approval is final, there is no "mark paid" step
-- ----------------------------------------------------------------------------
-- The cashier pays cash against the printed voucher and nobody records that in
-- the system. A claim now goes  pending_approval -> approved  and stops there.
--
--  * staff_trip_fuel_pay no longer works (it says so). The 'paid' status and the
--    paid_by / paid_at / paid_remarks columns stay for vouchers that were already
--    marked paid (TFV-000001); those keep counting as approved.
--  * staff_trip_fuel_cancel: a pending claim can be cancelled by the claimant or
--    an HR manager, an APPROVED voucher only by an HR manager (cash may already
--    have been handed over).
--  * staff_trip_fuel_review: the approval notice now says the cashier pays in cash
--    against the printed voucher (it goes to the claimant and the cashiers).
--  * expense_link_reconciliation: the Staff Trip Fuel side now counts approved
--    (and earlier paid) vouchers by the date HR approved them, not paid vouchers
--    by payment date.
--
-- Nothing else changes: no table or column is added, removed or rewritten.
-- Rollback: supabase/rollbacks/20261015120000_trip_fuel_approval_final_down.sql
-- ============================================================================

-- 1. Marking paid is retired -------------------------------------------------------

CREATE OR REPLACE FUNCTION public.staff_trip_fuel_pay(p_id uuid, p_remarks text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Staff trip fuel is not marked paid. HR approval is final; the cashier pays against the printed voucher.';
END;
$$;

-- 2. Approval notice -----------------------------------------------------------------

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
    PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel voucher approved',
      public.staff_trip_fuel_label(v) || ' is approved for Rs ' || trim(to_char(v.amount, 'FM999999990'))
        || '. The cashier pays it in cash against the printed voucher.' || COALESCE(' ' || NULLIF(btrim(p_remarks), ''), ''),
      'success', true, false, true);
  ELSE
    PERFORM public.staff_trip_fuel_notify(v, 'Trip fuel claim rejected',
      public.staff_trip_fuel_label(v) || ': ' || btrim(p_remarks), 'warning', true, false, false);
  END IF;
  RETURN v_status;
END;
$$;

-- 3. Cancel: an approved voucher only by an HR manager ---------------------------------

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
  IF v.status = 'approved' THEN
    IF NOT public.staff_trip_fuel_can('approve') THEN
      RAISE EXCEPTION 'Fuel voucher % is approved. Only an HR manager can cancel it.', v.voucher_number;
    END IF;
  ELSIF NOT (public.staff_trip_fuel_can('approve') OR v.created_by = v_uid) THEN
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

-- 4. Reconciliation: trip fuel = approved vouchers by approval date ---------------------

CREATE OR REPLACE FUNCTION public.expense_link_reconciliation(p_from date, p_to date)
RETURNS TABLE (
  row_kind text,
  expense_account_id uuid, expense_account_code text, expense_account_name text,
  funding_account_id uuid, funding_account_code text,
  month date,
  source_refs text[], source_labels text[], link_ids uuid[],
  source_amount numeric, source_count bigint,
  gl_amount numeric, gl_count bigint,
  difference numeric, tolerance numeric, status text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
WITH src AS (
  SELECT 'trip_fuel'::text AS stype, 'staff_trip_fuel'::text AS skey, 'Staff Trip Fuel'::text AS slabel,
         (v.approved_at AT TIME ZONE 'Asia/Karachi')::date AS d,
         date_trunc('month', (v.approved_at AT TIME ZONE 'Asia/Karachi')::date)::date AS m, v.amount::numeric AS amt
    FROM public.staff_trip_fuel_vouchers v
   WHERE v.status IN ('approved','paid') AND v.approved_at IS NOT NULL
     AND (v.approved_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
  UNION ALL
  SELECT 'petty_cash_category', COALESCE(e.category_id::text, 'none'), COALESCE(c.name, 'Uncategorized'),
         e.entry_date, date_trunc('month', e.entry_date)::date, e.amount::numeric
    FROM public.petty_cash_entries e
    LEFT JOIN public.expense_categories c ON c.id = e.category_id
   WHERE e.entry_type = 'expense' AND e.approval_status <> 'rejected'
     AND e.entry_date BETWEEN p_from AND p_to
),
lk AS (
  SELECT l.id, l.source_type, l.source_key, l.expense_account_id, l.funding_account_id, l.tolerance, l.compare_from,
         COALESCE(l.funding_account_id, '00000000-0000-0000-0000-000000000000'::uuid) AS fkey,
         CASE WHEN l.source_type = 'petty_cash_category'
              THEN COALESCE((SELECT c.name FROM public.expense_categories c WHERE c.id::text = l.source_key), l.source_label)
              ELSE l.source_label END AS label
    FROM public.expense_account_links l
   WHERE l.is_active
),
grp AS (
  SELECT lk.expense_account_id AS eid, lk.fkey,
         (array_agg(lk.funding_account_id))[1] AS fid,
         max(lk.tolerance) AS tol,
         min(lk.compare_from) AS cfrom,
         array_agg(lk.id ORDER BY lk.label) AS ids,
         array_agg(lk.source_type || ':' || lk.source_key ORDER BY lk.label) AS refs,
         array_agg(lk.label ORDER BY lk.label) AS labels
    FROM lk
   GROUP BY lk.expense_account_id, lk.fkey
),
srcg AS (
  SELECT lk.expense_account_id AS eid, lk.fkey, s.m, sum(s.amt) AS amt, count(*) AS n
    FROM src s
    JOIN lk ON lk.source_type = s.stype AND lk.source_key = s.skey
   WHERE s.d >= COALESCE(lk.compare_from, p_from)
   GROUP BY lk.expense_account_id, lk.fkey, s.m
),
gl AS (
  SELECT g.eid, g.fkey, date_trunc('month', v.voucher_date)::date AS m,
         sum(l.debit_amount - l.credit_amount) AS amt, count(*) AS n
    FROM grp g
    JOIN public.accounting_voucher_lines l ON l.account_id = g.eid
    JOIN public.accounting_vouchers v ON v.id = l.voucher_id
   WHERE v.voucher_date BETWEEN GREATEST(p_from, COALESCE(g.cfrom, p_from)) AND p_to
     AND (g.fid IS NULL OR EXISTS (
            SELECT 1 FROM public.accounting_voucher_lines f
             WHERE f.voucher_id = v.id AND f.account_id = g.fid))
   GROUP BY g.eid, g.fkey, date_trunc('month', v.voucher_date)::date
),
months AS (
  SELECT eid, fkey, m FROM srcg
  UNION
  SELECT eid, fkey, m FROM gl
),
linked AS (
  SELECT 'linked'::text AS row_kind, g.eid AS expense_account_id, a.code::text AS ecode, a.name::text AS ename,
         g.fid AS funding_account_id, fa.code::text AS fcode, mo.m AS month,
         g.refs, g.labels, g.ids,
         COALESCE(s.amt, 0) AS src_amt, COALESCE(s.n, 0)::bigint AS src_n,
         COALESCE(x.amt, 0) AS gl_amt, COALESCE(x.n, 0)::bigint AS gl_n,
         COALESCE(s.amt, 0) - COALESCE(x.amt, 0) AS diff, g.tol
    FROM months mo
    JOIN grp g ON g.eid = mo.eid AND g.fkey = mo.fkey
    JOIN public.accounting_chart_of_accounts a ON a.id = g.eid
    LEFT JOIN public.accounting_chart_of_accounts fa ON fa.id = g.fid
    LEFT JOIN srcg s ON s.eid = mo.eid AND s.fkey = mo.fkey AND s.m = mo.m
    LEFT JOIN gl x ON x.eid = mo.eid AND x.fkey = mo.fkey AND x.m = mo.m
),
unlinked AS (
  SELECT 'unlinked'::text AS row_kind, NULL::uuid AS expense_account_id, NULL::text AS ecode, NULL::text AS ename,
         NULL::uuid AS funding_account_id, NULL::text AS fcode, s.m AS month,
         ARRAY[s.stype || ':' || s.skey] AS refs, ARRAY[s.slabel] AS labels, NULL::uuid[] AS ids,
         sum(s.amt) AS src_amt, count(*)::bigint AS src_n,
         NULL::numeric AS gl_amt, 0::bigint AS gl_n, NULL::numeric AS diff, NULL::numeric AS tol
    FROM src s
   WHERE NOT EXISTS (SELECT 1 FROM lk WHERE lk.source_type = s.stype AND lk.source_key = s.skey)
   GROUP BY s.stype, s.skey, s.slabel, s.m
)
SELECT u.row_kind, u.expense_account_id, u.ecode, u.ename, u.funding_account_id, u.fcode, u.month,
       u.refs, u.labels, u.ids, u.src_amt, u.src_n, u.gl_amt, u.gl_n, u.diff, u.tol, u.status
  FROM (
    SELECT l.*, CASE WHEN abs(l.diff) <= l.tol THEN 'matched' ELSE 'warning' END AS status FROM linked l
    UNION ALL
    SELECT n.*, 'no_link'::text AS status FROM unlinked n
  ) u
 ORDER BY u.month, u.ecode NULLS LAST, u.labels;
$$;

UPDATE public.expense_account_links
   SET notes = 'Seeded: approved trip fuel vouchers are posted by hand as cash payment vouchers to Fuel & Travel, credited to Petty Cash.'
 WHERE source_type = 'trip_fuel' AND source_key = 'staff_trip_fuel' AND notes LIKE 'Seeded: paid trip fuel%';

GRANT EXECUTE ON FUNCTION
  public.staff_trip_fuel_pay(uuid, text),
  public.staff_trip_fuel_review(uuid, boolean, text),
  public.staff_trip_fuel_cancel(uuid, text),
  public.expense_link_reconciliation(date, date)
  TO anon, authenticated, service_role;
