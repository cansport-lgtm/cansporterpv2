-- Rollback for 20261005120100_master_data_change_tracking.sql (and the role in
-- 20261005120000_master_data_admin_role.sql, which cannot be removed: enum
-- values stay; unassign master_data_admin from users instead).
--
-- Rows already written to audit_log with module = 'master_data' are kept
-- (the log is append-only history). Only the triggers and the index go.

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
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
    END IF;
  END LOOP;
END;
$$;

DROP INDEX IF EXISTS public.idx_audit_log_module_record_type_created;
