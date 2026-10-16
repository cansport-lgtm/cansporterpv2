-- Rollback for 20261008120200_store_pass_reconciliation.sql
-- Removes the reconciliation, the gate check store-pass hook and the daily
-- notification. gate_pass_gate_check goes back to the Phase 2/3 wrapper (scrap
-- is weighed, everything else counted). Step 1 (passes, tracking) stays.
-- Left as they are: system_notifications rows and 'no_store_pass' gate pass events.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'store-pass-discrepancies';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.gate_pass_gate_check(
  p_id uuid, p_counts jsonb, p_vehicle text DEFAULT NULL, p_note text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.gate_passes WHERE id = p_id AND pass_type = 'scrap') THEN
    RAISE EXCEPTION 'A scrap pass is weighed at the gate, not counted.';
  END IF;
  RETURN public.gate_pass_gate_check_count(p_id, p_counts, p_vehicle, p_note);
END;
$$;

DROP FUNCTION IF EXISTS public.store_pass_notify_discrepancies();
DROP FUNCTION IF EXISTS public.store_pass_gate_status(uuid);
DROP FUNCTION IF EXISTS public.store_pass_missing_for_gate_pass(uuid);
DROP FUNCTION IF EXISTS public.store_pass_settings_save(text);
DROP FUNCTION IF EXISTS public.store_pass_recon_reopen(uuid, text);
DROP FUNCTION IF EXISTS public.store_pass_recon_resolve(uuid, text, text);
DROP FUNCTION IF EXISTS public.store_pass_reconcile_products(date, date);
DROP FUNCTION IF EXISTS public.store_pass_reconcile(date, date);
DROP FUNCTION IF EXISTS public.store_pass_recon_dispatch_ids(date, date);
DROP FUNCTION IF EXISTS public.store_pass_recon_can();
DROP FUNCTION IF EXISTS public.store_pass_code_severity(text);
DROP FUNCTION IF EXISTS public.store_pass_pk_date(timestamptz);

DROP TABLE IF EXISTS public.store_pass_recon_notes;
DROP TABLE IF EXISTS public.store_pass_settings;
