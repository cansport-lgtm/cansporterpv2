-- Rollback for 20261022130000_product_materials_stock_check.sql
-- Removes product material columns, the stock check, its snapshots and alerts.
-- Product masters, items, Stock Closing and GRN data are untouched.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job
     WHERE jobname IN ('material-morning-summary', 'material-count-reminder');
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_sales_order_material_check ON public.sales_orders;
DROP TRIGGER IF EXISTS trg_soi_material_recheck_ins ON public.sales_order_items;
DROP TRIGGER IF EXISTS trg_soi_material_recheck_upd ON public.sales_order_items;
DROP TRIGGER IF EXISTS trg_soi_material_recheck_del ON public.sales_order_items;
DROP TRIGGER IF EXISTS trg_distributor_order_material_check ON public.distributor_orders;
DROP TRIGGER IF EXISTS trg_doi_material_recheck_ins ON public.distributor_order_items;
DROP TRIGGER IF EXISTS trg_doi_material_recheck_upd ON public.distributor_order_items;
DROP TRIGGER IF EXISTS trg_doi_material_recheck_del ON public.distributor_order_items;
DROP TRIGGER IF EXISTS trg_items_require_subcategory ON public.items;

DROP FUNCTION IF EXISTS public.trg_sales_order_material_check();
DROP FUNCTION IF EXISTS public.trg_sales_order_items_material_recheck();
DROP FUNCTION IF EXISTS public.trg_distributor_order_material_check();
DROP FUNCTION IF EXISTS public.trg_distributor_order_items_material_recheck();
DROP FUNCTION IF EXISTS public.material_morning_summary();
DROP FUNCTION IF EXISTS public.material_count_reminder();
DROP FUNCTION IF EXISTS public.material_shortage_summary();
DROP FUNCTION IF EXISTS public.material_set_purchase_status(uuid, text, text, uuid);
DROP FUNCTION IF EXISTS public.material_check_close(text, uuid, text);
DROP FUNCTION IF EXISTS public.material_check_run(text, uuid, uuid);
DROP FUNCTION IF EXISTS public.material_check_preview(text, uuid);
DROP FUNCTION IF EXISTS public.material_check_compute(text, uuid);
DROP FUNCTION IF EXISTS public.material_alert_roles();
DROP FUNCTION IF EXISTS public.material_suggest_qty(numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.item_stock_now(uuid[]);
DROP FUNCTION IF EXISTS public.distributor_qty_dozens(numeric, text);
DROP FUNCTION IF EXISTS public.pk_today();
DROP FUNCTION IF EXISTS public.items_require_subcategory();

DROP TABLE IF EXISTS public.material_check_lines;
DROP TABLE IF EXISTS public.material_checks;
DROP VIEW IF EXISTS public.v_product_materials_effective;
DROP TABLE IF EXISTS public.product_material_log;
DROP TABLE IF EXISTS public.product_materials;
DROP FUNCTION IF EXISTS public.product_materials_log_change();
DROP FUNCTION IF EXISTS public.product_materials_validate();
DROP TABLE IF EXISTS public.product_material_slots;

ALTER TABLE public.consumption_categories DROP COLUMN IF EXISTS requires_subcategory;
ALTER TABLE public.products DROP COLUMN IF EXISTS color;

DELETE FROM public.notifications
 WHERE reference_type IN ('material_check', 'material_summary', 'material_count_reminder');
