-- ============================================================
-- Super Admin Audit Trail — wave 1
-- Modules covered: accounting, sales, purchase, labour, production
--
-- The app uses its own auth (app_users + verify_user_password), not
-- Supabase Auth, so auth.uid() is always NULL here. Attribution comes
-- from an `x-app-user-id` request header the frontend attaches to every
-- Supabase call after login (see src/integrations/supabase/client.ts).
--
-- What this migration does:
--   1. app_user_id() / request_header(): resolve the acting ERP user
--      (and IP / user agent) from the incoming request.
--   2. audit_log becomes the single central trail: a BEFORE INSERT
--      trigger fills user/ip/agent server-side, clients lose
--      UPDATE/DELETE on it (append-only), and query indexes are added.
--   3. audit_row_change(): one generic row-change trigger recording
--      before/after JSONB snapshots into audit_log; attached to every
--      wave-1 table listed at the bottom.
--   4. verify_user_password() now also records login / login_failed
--      events (it already stamped last_login).
--   5. The old accounting-only trail (accounting_audit_log + its two
--      triggers) is folded into the central audit_log and its triggers
--      are replaced by the generic one. The old table is kept as an
--      inert archive; nothing writes to it any more.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Request-context helpers
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_header(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql STABLE
AS $$
BEGIN
  RETURN current_setting('request.headers', true)::json ->> lower(p_name);
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- The acting ERP user for this request. NULL when the header is missing,
-- malformed, or does not match a real app_users row.
CREATE OR REPLACE FUNCTION public.app_user_id()
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_raw TEXT;
  v_uid UUID;
BEGIN
  v_raw := public.request_header('x-app-user-id');
  IF v_raw IS NULL OR v_raw = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    v_uid := v_raw::uuid;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;

  IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = v_uid) THEN
    RETURN NULL;
  END IF;

  RETURN v_uid;
END;
$$;

-- ------------------------------------------------------------
-- 2. Central audit_log: server-side defaults, append-only, indexes
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_log_fill_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- The request header wins over anything the client claims; an explicit
  -- user_id survives only when no header is present (e.g. login events
  -- inserted by verify_user_password before a session exists).
  NEW.user_id := COALESCE(public.app_user_id(), NEW.user_id);
  NEW.ip_address := COALESCE(
    NEW.ip_address,
    NULLIF(trim(split_part(public.request_header('x-forwarded-for'), ',', 1)), '')
  );
  NEW.user_agent := COALESCE(NEW.user_agent, public.request_header('user-agent'));
  NEW.created_at := COALESCE(NEW.created_at, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_fill_defaults ON public.audit_log;
CREATE TRIGGER audit_log_fill_defaults
  BEFORE INSERT ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_fill_defaults();

-- Append-only from clients: read + insert stay open (permissions are
-- enforced client-side throughout this app), but nobody can rewrite or
-- erase history through the API.
DROP POLICY IF EXISTS "Full access" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (true);
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
CREATE POLICY "audit_log_insert" ON public.audit_log
  FOR INSERT WITH CHECK (true);
REVOKE UPDATE, DELETE ON public.audit_log FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_audit_log_created_at
  ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
  ON public.audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_module_created
  ON public.audit_log (module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_record
  ON public.audit_log (record_type, record_id);

-- ------------------------------------------------------------
-- 3. Generic row-change audit trigger
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_row_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_module TEXT := COALESCE(TG_ARGV[0], TG_TABLE_NAME);
  v_old JSONB;
  v_new JSONB;
  v_record UUID;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    v_old := to_jsonb(OLD) - 'password_hash';
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_new := to_jsonb(NEW) - 'password_hash';
  END IF;

  -- Skip UPDATEs where nothing but the updated_at stamp changed
  IF TG_OP = 'UPDATE' AND (v_old - 'updated_at') = (v_new - 'updated_at') THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_record := (COALESCE(v_new ->> 'id', v_old ->> 'id'))::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_record := NULL;
  END;

  -- user_id / ip / user agent are filled by audit_log_fill_defaults
  INSERT INTO public.audit_log (action, module, record_id, record_type, old_values, new_values)
  VALUES (
    CASE TG_OP WHEN 'INSERT' THEN 'create' WHEN 'UPDATE' THEN 'update' ELSE 'delete' END,
    v_module,
    v_record,
    TG_TABLE_NAME,
    v_old,
    v_new
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ------------------------------------------------------------
-- 4. Login / failed-login events
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_user_password(p_user_id VARCHAR, p_password VARCHAR)
RETURNS TABLE(user_uuid UUID, is_valid BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_uuid UUID;
  v_password_hash TEXT;
BEGIN
  SELECT id, password_hash INTO v_user_uuid, v_password_hash
  FROM public.app_users
  WHERE user_id = p_user_id AND is_active = true;

  IF v_user_uuid IS NOT NULL AND v_password_hash = extensions.crypt(p_password, v_password_hash) THEN
    UPDATE public.app_users SET last_login = now() WHERE id = v_user_uuid;
    INSERT INTO public.audit_log (user_id, action, module, new_values)
    VALUES (v_user_uuid, 'login', 'auth', jsonb_build_object('user_id', p_user_id));
    RETURN QUERY SELECT v_user_uuid, true;
  ELSE
    -- v_user_uuid is set when the account exists but the password was wrong,
    -- NULL for unknown/inactive accounts; the attempted login name is kept
    -- either way.
    INSERT INTO public.audit_log (user_id, action, module, new_values)
    VALUES (v_user_uuid, 'login_failed', 'auth', jsonb_build_object('attempted_user_id', p_user_id));
    RETURN QUERY SELECT NULL::UUID, false;
  END IF;
END;
$$;

-- ------------------------------------------------------------
-- 5. Fold the accounting-only trail into the central log
-- ------------------------------------------------------------

DROP TRIGGER IF EXISTS accounting_vouchers_audit ON public.accounting_vouchers;
DROP TRIGGER IF EXISTS accounting_voucher_lines_audit ON public.accounting_voucher_lines;
DROP FUNCTION IF EXISTS public.accounting_audit_trigger();

INSERT INTO public.audit_log (user_id, action, module, record_id, record_type, old_values, new_values, created_at)
SELECT
  CASE WHEN EXISTS (SELECT 1 FROM public.app_users u WHERE u.id = a.changed_by)
       THEN a.changed_by ELSE NULL END,
  CASE a.operation
    WHEN 'INSERT' THEN 'create'
    WHEN 'UPDATE' THEN 'update'
    WHEN 'DELETE' THEN 'delete'
    ELSE lower(a.operation)
  END,
  'accounting',
  a.row_id,
  a.table_name,
  a.before_data,
  a.after_data,
  a.changed_at
FROM public.accounting_audit_log a
WHERE NOT EXISTS (
  SELECT 1 FROM public.audit_log al
  WHERE al.record_type = a.table_name
    AND al.record_id = a.row_id
    AND al.created_at = a.changed_at
);

-- ------------------------------------------------------------
-- 6. Attach the audit trigger to the wave-1 tables
-- ------------------------------------------------------------

DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT * FROM (VALUES
      -- Accounting
      ('accounting', 'accounting_vouchers'),
      ('accounting', 'accounting_voucher_lines'),
      ('accounting', 'accounting_parties'),
      ('accounting', 'accounting_chart_of_accounts'),
      ('accounting', 'accounting_default_accounts'),
      ('accounting', 'accounting_period_close'),
      ('accounting', 'accounting_budgets'),
      -- Sales (domestic)
      ('sales', 'sales_orders'),
      ('sales', 'sales_order_items'),
      ('sales', 'domestic_invoices'),
      ('sales', 'domestic_invoice_items'),
      ('sales', 'sales_dispatches'),
      ('sales', 'sales_dispatch_orders'),
      ('sales', 'sales_dispatch_items'),
      ('sales', 'sales_returns'),
      ('sales', 'sales_return_items'),
      ('sales', 'customers'),
      ('sales', 'customer_pricing'),
      ('sales', 'payment_receipts'),
      -- Purchase
      ('purchase', 'purchase_orders'),
      ('purchase', 'purchase_order_items'),
      ('purchase', 'goods_receipt_notes'),
      ('purchase', 'grn_items'),
      ('purchase', 'purchase_returns'),
      ('purchase', 'purchase_return_items'),
      ('purchase', 'suppliers'),
      ('purchase', 'purchase_qc_inspections'),
      -- Labour productivity
      ('labour', 'labour_productivity_targets'),
      ('labour', 'labour_employees'),
      ('labour', 'labour_process_targets'),
      ('labour', 'labour_attendance_allowances'),
      ('labour', 'labour_advances'),
      ('labour', 'labour_travel_advances'),
      ('labour', 'labour_salary_snapshots'),
      ('labour', 'labour_productivity_edit_requests'),
      -- Production
      ('production', 'production_entries'),
      ('production', 'production_rejections'),
      ('production', 'production_orders'),
      ('production', 'production_order_items'),
      ('production', 'production_targets')
    ) AS m(module, table_name)
  LOOP
    IF to_regclass('public.' || t.table_name) IS NULL THEN
      RAISE NOTICE 'audit trail: table public.% not found, trigger skipped', t.table_name;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t.table_name);
    EXECUTE format(
      'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)',
      t.table_name,
      t.module
    );
  END LOOP;
END;
$$;
