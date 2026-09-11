-- Rollback for 20260911120000_grn_notifications.sql
DROP TRIGGER IF EXISTS trg_notify_new_grn ON public.goods_receipt_notes;
DROP FUNCTION IF EXISTS public.notify_new_grn();
