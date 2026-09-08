-- Rollback for 20260908120000_partial_goods_receiving.sql
-- Note: the status backfill is not reversed; 'partially_received' remains a
-- valid status that predates this migration.
DROP TRIGGER IF EXISTS trigger_zz_recalc_po_receipt_status ON public.grn_items;
DROP TRIGGER IF EXISTS trigger_validate_po_item_over_receipt ON public.grn_items;
DROP FUNCTION IF EXISTS public.recalc_po_receipt_status();
DROP FUNCTION IF EXISTS public.validate_po_item_over_receipt();
