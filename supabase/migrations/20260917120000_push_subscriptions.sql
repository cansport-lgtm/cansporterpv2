-- Web Push subscriptions
--
-- Delivery level 3 from docs/SYSTEM_NOTIFICATIONS.md: push notifications that
-- reach the device even when the app/PWA is fully closed. Each browser/device
-- a user grants notification permission on stores one row here (its Push API
-- subscription). Whenever a row lands in `public.notifications`, a trigger
-- fires the `send-web-push` Edge Function, which sends a Web Push message to
-- every subscription belonging to that notification's recipient.
--
-- The `notifications` table stays the single source of truth — this only
-- adds a delivery channel on top of it, no producer needs to change.

CREATE TABLE public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Same model as public.notifications: the app has no Supabase Auth session,
-- so authorization is enforced client/RPC-side, not via RLS predicates.
CREATE POLICY "Allow all operations on push_subscriptions"
    ON public.push_subscriptions FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Fan a new notification out to Web Push
-- ============================================================
-- Fire-and-forget HTTP call via pg_net (already enabled — see
-- 20260628160000_enable_pg_net.sql). The Edge Function looks up the
-- recipient's subscriptions and sends the push(es); this trigger never
-- blocks or fails the notification insert on push errors.
CREATE OR REPLACE FUNCTION public.trigger_send_web_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    PERFORM net.http_post(
        url := 'https://ojejlhnthhdvgbgpsgvi.supabase.co/functions/v1/send-web-push',
        headers := '{"Content-Type":"application/json","apikey":"sb_publishable_maHf4XFU4sbsRHv1Z-8jgw_5qoDvpYq"}'::jsonb,
        body := jsonb_build_object(
            'notificationId', NEW.id,
            'recipientId', NEW.recipient_id,
            'title', NEW.title,
            'message', NEW.message,
            'link', NEW.link
        )
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_send_web_push
    AFTER INSERT ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.trigger_send_web_push();
