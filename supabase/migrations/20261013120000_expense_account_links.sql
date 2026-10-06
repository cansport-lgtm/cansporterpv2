-- ============================================================================
-- Expense Account Links: operational expense sources linked to ledger accounts
-- ----------------------------------------------------------------------------
-- Petty cash and staff trip fuel are paid in cash and then posted by hand in
-- Accounting as cash payment vouchers. Nothing posts automatically. This adds
-- a link between an operational expense source and the expense account its
-- postings should land in, and a reconciliation that compares, month by month,
-- what the operational side says was paid with what the ledger shows posted.
--
-- Sources (extend the CHECK and the source CTE in expense_link_reconciliation
-- to add more, e.g. general expense categories or utility types):
--   petty_cash_category  one link per petty cash category. Amounts are petty
--                        cash expense entries that are not rejected, by entry
--                        date. (Entries are rarely approved today, so pending
--                        ones count, like the Operating Expenses Analysis.)
--   trip_fuel            Staff Trip Fuel vouchers marked paid, by the date the
--                        cashier marked them paid (Asia/Karachi).
--
-- A link names the expense account, the cash account the postings are expected
-- to credit (Petty Cash 6002), a tolerance in rupees (default 1) and an optional
-- compare-from date. Nothing before that date is compared, on either side, so an
-- account that already held unrelated postings (Fuel & Travel has one from July)
-- does not raise a false warning. Links that share an account should share the
-- start date; the ledger side uses the earliest.
--
-- Reconciliation grain: expense account + funding account + month. Sources
-- linked to the same account and funding account are compared together against
-- the ledger. The ledger side is the net debit (debit minus credit) of every
-- voucher line on the expense account, in vouchers that also touch the funding
-- account, by voucher date. Reversals net out, like the Profit & Loss.
--
-- Status per month: matched when |source - ledger| <= tolerance, warning
-- otherwise; sources with amounts but no link come back as no_link.
--
-- Read-only to clients: links are written by expense_account_link_save /
-- _delete, which need super_admin or accounting_manager. Nothing here writes
-- to the ledger, petty cash or trip fuel.
--
-- Seeds one link: Staff Trip Fuel -> 5209 Fuel & Travel, funded from 6002 Petty
-- Cash, tolerance Rs 1, compared from 2026-10-01 (the day trip fuel went live).
-- Petty cash categories are linked by the accountant on the Expense Account
-- Links page.
--
-- Rollback: supabase/rollbacks/20261013120000_expense_account_links_down.sql
-- ============================================================================

-- 1. Table ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.expense_account_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('petty_cash_category','trip_fuel')),
  source_key text NOT NULL,
  source_label text NOT NULL,
  expense_account_id uuid NOT NULL REFERENCES public.accounting_chart_of_accounts(id) ON DELETE RESTRICT,
  funding_account_id uuid REFERENCES public.accounting_chart_of_accounts(id) ON DELETE SET NULL,
  tolerance numeric(10,2) NOT NULL DEFAULT 1 CHECK (tolerance >= 0),
  compare_from date,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_key)
);
CREATE INDEX IF NOT EXISTS expense_account_links_account_idx ON public.expense_account_links (expense_account_id);

ALTER TABLE public.expense_account_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read expense_account_links" ON public.expense_account_links;
CREATE POLICY "Read expense_account_links" ON public.expense_account_links FOR SELECT TO public USING (true);
GRANT SELECT ON public.expense_account_links TO anon, authenticated, service_role;
GRANT ALL ON public.expense_account_links TO service_role;

DROP TRIGGER IF EXISTS audit_row_change ON public.expense_account_links;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR UPDATE OR DELETE ON public.expense_account_links
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('accounting');

-- 2. Permissions and writes ------------------------------------------------------

CREATE OR REPLACE FUNCTION public.expense_link_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'edit' THEN ARRAY['super_admin','accounting_manager']
    ELSE ARRAY[]::text[] END);
$$;

CREATE OR REPLACE FUNCTION public.expense_account_link_save(
  p_source_type text, p_source_key text, p_expense_account_id uuid,
  p_funding_account_id uuid DEFAULT NULL, p_tolerance numeric DEFAULT 1, p_notes text DEFAULT NULL,
  p_compare_from date DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_label text;
  v_tol numeric := COALESCE(p_tolerance, 1);
  v_id uuid;
BEGIN
  IF NOT public.expense_link_can('edit') THEN
    RAISE EXCEPTION 'Only a super admin or an accounting manager can change expense account links.';
  END IF;
  IF p_source_type = 'trip_fuel' THEN
    IF p_source_key IS DISTINCT FROM 'staff_trip_fuel' THEN
      RAISE EXCEPTION 'Unknown trip fuel source.';
    END IF;
    v_label := 'Staff Trip Fuel';
  ELSIF p_source_type = 'petty_cash_category' THEN
    SELECT c.name INTO v_label FROM public.expense_categories c
     WHERE c.id::text = p_source_key AND c.category_type = 'petty_cash';
    IF v_label IS NULL THEN
      RAISE EXCEPTION 'Petty cash category not found.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unknown source type %.', p_source_type;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.accounting_chart_of_accounts a
                  WHERE a.id = p_expense_account_id AND a.account_type::text = 'expense' AND a.is_active) THEN
    RAISE EXCEPTION 'Choose an active expense account.';
  END IF;
  IF p_funding_account_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.accounting_chart_of_accounts a
        WHERE a.id = p_funding_account_id AND a.account_type::text = 'asset' AND a.is_active) THEN
    RAISE EXCEPTION 'The funding account must be an active cash or bank account.';
  END IF;
  IF v_tol < 0 THEN
    RAISE EXCEPTION 'The tolerance cannot be negative.';
  END IF;

  INSERT INTO public.expense_account_links
    (source_type, source_key, source_label, expense_account_id, funding_account_id, tolerance, compare_from, notes, created_by, updated_by)
  VALUES
    (p_source_type, p_source_key, v_label, p_expense_account_id, p_funding_account_id, v_tol, p_compare_from,
     NULLIF(btrim(p_notes), ''), public.app_user_id(), public.app_user_id())
  ON CONFLICT (source_type, source_key) DO UPDATE
     SET source_label = EXCLUDED.source_label,
         expense_account_id = EXCLUDED.expense_account_id,
         funding_account_id = EXCLUDED.funding_account_id,
         tolerance = EXCLUDED.tolerance,
         compare_from = EXCLUDED.compare_from,
         notes = EXCLUDED.notes,
         is_active = true,
         updated_by = public.app_user_id(),
         updated_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.expense_account_link_delete(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.expense_link_can('edit') THEN
    RAISE EXCEPTION 'Only a super admin or an accounting manager can change expense account links.';
  END IF;
  DELETE FROM public.expense_account_links WHERE id = p_id;
END;
$$;

-- 3. Reconciliation ---------------------------------------------------------------

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
         (v.paid_at AT TIME ZONE 'Asia/Karachi')::date AS d,
         date_trunc('month', (v.paid_at AT TIME ZONE 'Asia/Karachi')::date)::date AS m, v.amount::numeric AS amt
    FROM public.staff_trip_fuel_vouchers v
   WHERE v.status = 'paid' AND v.paid_at IS NOT NULL
     AND (v.paid_at AT TIME ZONE 'Asia/Karachi')::date BETWEEN p_from AND p_to
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

-- 4. Seed: Staff Trip Fuel -> 5209 Fuel & Travel, funded from 6002 Petty Cash -----------

INSERT INTO public.expense_account_links
  (source_type, source_key, source_label, expense_account_id, funding_account_id, tolerance, compare_from, notes)
SELECT 'trip_fuel', 'staff_trip_fuel', 'Staff Trip Fuel', e.id, f.id, 1, DATE '2026-10-01',
       'Seeded: paid trip fuel vouchers are posted by hand as cash payment vouchers to Fuel & Travel, credited to Petty Cash.'
  FROM (SELECT id FROM public.accounting_chart_of_accounts WHERE code = '5209' AND account_type::text = 'expense' ORDER BY created_at LIMIT 1) e,
       (SELECT id FROM public.accounting_chart_of_accounts WHERE code = '6002' AND account_type::text = 'asset' ORDER BY created_at LIMIT 1) f
ON CONFLICT (source_type, source_key) DO NOTHING;

-- 5. Grants -------------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION
  public.expense_link_can(text),
  public.expense_account_link_save(text, text, uuid, uuid, numeric, text, date),
  public.expense_account_link_delete(uuid),
  public.expense_link_reconciliation(date, date)
  TO anon, authenticated, service_role;
