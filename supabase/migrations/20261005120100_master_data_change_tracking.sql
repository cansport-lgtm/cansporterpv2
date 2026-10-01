-- ============================================================================
-- Master Data change tracking
-- ----------------------------------------------------------------------------
-- Puts every Master Data table under the central audit trail
-- (public.audit_log, see 20260901120000_super_admin_audit_trail.sql) with
-- module = 'master_data'. The generic audit_row_change() trigger records a
-- before/after JSONB snapshot of each insert / update / delete, and
-- audit_log_fill_defaults() stamps the acting ERP user (x-app-user-id header),
-- IP and user agent server-side — so the log says WHO changed WHAT and WHEN
-- without any help from the frontend.
--
-- Super admin reads it on Master Data → Change Log (/master/change-log),
-- which filters audit_log on module = 'master_data'. It also appears in the
-- general Settings → Audit Log under the "Master Data" module.
--
-- Tables covered (the Master Data module's pages):
--   production_departments, production_sub_departments   Departments
--   grades                                               Grades
--   products                                             Products / SKUs (own + customer SKUs)
--   items                                                Items
--   units_of_measure                                     Units
--   defect_reasons, downtime_reasons                     Reason Masters
--   hourly_loss_reasons, hourly_loss_reason_processes    Hourly Loss Reasons
--
-- Rollback: supabase/rollbacks/20261005120100_master_data_change_tracking_down.sql
-- ============================================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'production_departments',
    'production_sub_departments',
    'grades',
    'products',
    'items',
    'units_of_measure',
    'defect_reasons',
    'downtime_reasons',
    'hourly_loss_reasons',
    'hourly_loss_reason_processes'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'master data audit: table public.% not found, trigger skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)',
      t,
      'master_data'
    );
  END LOOP;
END;
$$;

-- The Change Log page filters on module + time and on module + table; the
-- existing (module, created_at) index covers the first, this one the second.
CREATE INDEX IF NOT EXISTS idx_audit_log_module_record_type_created
  ON public.audit_log (module, record_type, created_at DESC);
