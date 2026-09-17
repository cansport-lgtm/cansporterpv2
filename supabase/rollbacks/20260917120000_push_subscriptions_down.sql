-- Rollback for 20260917120000_push_subscriptions.sql

DROP TRIGGER IF EXISTS trg_send_web_push ON public.notifications;
DROP FUNCTION IF EXISTS public.trigger_send_web_push();
DROP TABLE IF EXISTS public.push_subscriptions;
