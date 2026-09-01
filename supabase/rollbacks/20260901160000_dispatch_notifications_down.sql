-- Rollback for 20260901160000_dispatch_notifications.sql
DROP TRIGGER IF EXISTS trg_notify_new_dispatch ON public.sales_dispatches;
DROP FUNCTION IF EXISTS public.notify_new_dispatch();
