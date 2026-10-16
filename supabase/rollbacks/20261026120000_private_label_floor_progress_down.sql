-- Rollback for 20261026120000_private_label_floor_progress.sql
-- (pljo_floor_orders keeps the extra fields; re-run 20261025120000 to restore the old version.)
DROP FUNCTION IF EXISTS public.pljo_floor_set_done(text, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.pljo_floor_add_progress(text, uuid, jsonb, text);
DROP FUNCTION IF EXISTS public.pljo_floor_progress(text, uuid);
DROP TABLE IF EXISTS public.private_label_job_order_progress;
ALTER TABLE public.private_label_job_orders
  DROP COLUMN IF EXISTS production_done_at,
  DROP COLUMN IF EXISTS production_done_by_name;
