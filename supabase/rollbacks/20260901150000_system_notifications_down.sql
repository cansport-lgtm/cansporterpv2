-- Rollback for 20260901150000_system_notifications.sql
DROP TRIGGER IF EXISTS trg_notify_po_pending_approval ON public.purchase_orders;
DROP FUNCTION IF EXISTS public.notify_po_pending_approval();
DROP FUNCTION IF EXISTS public.mark_all_notifications_read(UUID);
DROP FUNCTION IF EXISTS public.notify_role(app_role[], VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, VARCHAR, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.notify_user(UUID, VARCHAR, TEXT, VARCHAR, VARCHAR, TEXT, VARCHAR, UUID, UUID);
ALTER PUBLICATION supabase_realtime DROP TABLE public.notifications;
DROP TABLE IF EXISTS public.notifications;
