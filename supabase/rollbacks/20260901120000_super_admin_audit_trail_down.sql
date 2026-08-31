-- Rollback for 20260901120000_super_admin_audit_trail.sql
-- Removes the generic audit triggers and helpers, restores the previous
-- verify_user_password (no login logging), restores the accounting-only
-- audit triggers, and reopens audit_log (previous "Full access" policy).
-- Rows already written into audit_log (including the folded-in accounting
-- history) are left in place — audit history is never deleted by rollback.

-- Detach the generic trigger from all wave-1 tables
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'accounting_vouchers','accounting_voucher_lines','accounting_parties',
      'accounting_chart_of_accounts','accounting_default_accounts',
      'accounting_period_close','accounting_budgets',
      'sales_orders','sales_order_items','domestic_invoices','domestic_invoice_items',
      'sales_dispatches','sales_dispatch_orders','sales_dispatch_items',
      'sales_returns','sales_return_items','customers','customer_pricing','payment_receipts',
      'purchase_orders','purchase_order_items','goods_receipt_notes','grn_items',
      'purchase_returns','purchase_return_items','suppliers','purchase_qc_inspections',
      'labour_productivity_targets','labour_employees','labour_process_targets',
      'labour_attendance_allowances','labour_advances','labour_travel_advances',
      'labour_salary_snapshots','labour_productivity_edit_requests',
      'production_entries','production_rejections','production_orders',
      'production_order_items','production_targets'
    ])
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.audit_row_change();

-- Restore verify_user_password without login logging (as created in
-- 20260109183133_...sql)
CREATE OR REPLACE FUNCTION public.verify_user_password(p_user_id VARCHAR, p_password VARCHAR)
RETURNS TABLE(user_uuid UUID, is_valid BOOLEAN) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user_uuid UUID; v_password_hash TEXT;
BEGIN
    SELECT id, password_hash INTO v_user_uuid, v_password_hash FROM public.app_users WHERE user_id = p_user_id AND is_active = true;
    IF v_user_uuid IS NULL THEN RETURN QUERY SELECT NULL::UUID, false; RETURN; END IF;
    IF v_password_hash = extensions.crypt(p_password, v_password_hash) THEN
        UPDATE public.app_users SET last_login = now() WHERE id = v_user_uuid;
        RETURN QUERY SELECT v_user_uuid, true;
    ELSE RETURN QUERY SELECT NULL::UUID, false; END IF;
END;
$$;

-- Restore the accounting-only audit triggers (as created in
-- 20260519100000_accounting_audit_log.sql)
CREATE OR REPLACE FUNCTION public.accounting_audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID;
BEGIN
  BEGIN
    v_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_uid := NULL;
  END;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.accounting_audit_log (table_name, row_id, operation, after_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), v_uid);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.accounting_audit_log (table_name, row_id, operation, before_data, after_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_uid);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.accounting_audit_log (table_name, row_id, operation, before_data, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), v_uid);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS accounting_vouchers_audit ON public.accounting_vouchers;
CREATE TRIGGER accounting_vouchers_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.accounting_vouchers
  FOR EACH ROW EXECUTE FUNCTION public.accounting_audit_trigger();

DROP TRIGGER IF EXISTS accounting_voucher_lines_audit ON public.accounting_voucher_lines;
CREATE TRIGGER accounting_voucher_lines_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.accounting_voucher_lines
  FOR EACH ROW EXECUTE FUNCTION public.accounting_audit_trigger();

-- Reopen audit_log as before (single permissive policy, full grants)
DROP TRIGGER IF EXISTS audit_log_fill_defaults ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_fill_defaults();

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_insert" ON public.audit_log;
DROP POLICY IF EXISTS "Full access" ON public.audit_log;
CREATE POLICY "Full access" ON public.audit_log FOR ALL USING (true) WITH CHECK (true);
GRANT UPDATE, DELETE ON public.audit_log TO anon, authenticated;

DROP INDEX IF EXISTS public.idx_audit_log_created_at;
DROP INDEX IF EXISTS public.idx_audit_log_user_created;
DROP INDEX IF EXISTS public.idx_audit_log_module_created;
DROP INDEX IF EXISTS public.idx_audit_log_record;

DROP FUNCTION IF EXISTS public.app_user_id();
DROP FUNCTION IF EXISTS public.request_header(TEXT);
