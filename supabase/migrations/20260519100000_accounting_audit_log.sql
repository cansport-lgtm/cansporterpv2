-- ============================================================
-- Accounting audit log
-- Captures every INSERT/UPDATE/DELETE on accounting_vouchers and
-- accounting_voucher_lines at the DB level so even raw SQL edits
-- are recorded. Stores JSONB before/after snapshots.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.accounting_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  row_id UUID NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('INSERT', 'UPDATE', 'DELETE')),
  before_data JSONB,
  after_data JSONB,
  changed_by UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_accounting_audit_log_table_row
  ON public.accounting_audit_log(table_name, row_id);
CREATE INDEX IF NOT EXISTS idx_accounting_audit_log_changed_at
  ON public.accounting_audit_log(changed_at DESC);

ALTER TABLE public.accounting_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounting_audit_log_select" ON public.accounting_audit_log;
CREATE POLICY "accounting_audit_log_select"
  ON public.accounting_audit_log FOR SELECT
  USING (true);

GRANT SELECT ON public.accounting_audit_log TO anon, authenticated, service_role;
GRANT INSERT ON public.accounting_audit_log TO service_role;

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
