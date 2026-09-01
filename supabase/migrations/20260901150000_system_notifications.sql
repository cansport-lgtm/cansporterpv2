-- System Notifications
--
-- In-app notification infrastructure: a per-user `notifications` table that the
-- frontend bell (ERPHeader) reads in realtime, plus SQL helpers to emit
-- notifications to a single user (`notify_user`) or fan one out to every active
-- holder of a role (`notify_role`). Database triggers and application code both
-- use these helpers, so every "system" event lands in the same inbox.
--
-- As a first wired-up producer, a trigger notifies purchase managers/admins the
-- moment a purchase order enters 'pending_approval'.

-- ============================================================
-- Table
-- ============================================================
CREATE TABLE public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Who receives it. One row per recipient (role sends are fanned out).
    recipient_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    -- Severity drives the colored dot in the UI.
    type VARCHAR(20) NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
    -- Originating module ('purchase', 'qa', 'maintenance', …) for filtering.
    module VARCHAR(50),
    -- In-app route to open when the notification is clicked (e.g. '/purchase/orders').
    link TEXT,
    -- Optional pointer back to the record that caused the notification.
    reference_type VARCHAR(50),
    reference_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    read_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.app_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The bell's two queries: unread count + latest first for a user.
CREATE INDEX idx_notifications_recipient_unread
    ON public.notifications (recipient_id, is_read, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on notifications"
    ON public.notifications FOR ALL USING (true) WITH CHECK (true);

-- Stream INSERT/UPDATE events to the frontend bell.
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- ============================================================
-- Helpers
-- ============================================================

-- Notify one user. Returns the new notification id.
CREATE OR REPLACE FUNCTION public.notify_user(
    p_recipient_id UUID,
    p_title VARCHAR,
    p_message TEXT DEFAULT NULL,
    p_type VARCHAR DEFAULT 'info',
    p_module VARCHAR DEFAULT NULL,
    p_link TEXT DEFAULT NULL,
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_id UUID;
BEGIN
    INSERT INTO public.notifications
        (recipient_id, title, message, type, module, link, reference_type, reference_id, created_by)
    VALUES
        (p_recipient_id, p_title, p_message, COALESCE(p_type, 'info'), p_module, p_link,
         p_reference_type, p_reference_id, p_created_by)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- Notify every ACTIVE user holding any of the given roles (one row each, so
-- read state stays per-user). Skips p_exclude_user (usually the actor, who
-- doesn't need to be told about their own action). Returns rows created.
CREATE OR REPLACE FUNCTION public.notify_role(
    p_roles app_role[],
    p_title VARCHAR,
    p_message TEXT DEFAULT NULL,
    p_type VARCHAR DEFAULT 'info',
    p_module VARCHAR DEFAULT NULL,
    p_link TEXT DEFAULT NULL,
    p_reference_type VARCHAR DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_created_by UUID DEFAULT NULL,
    p_exclude_user UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    INSERT INTO public.notifications
        (recipient_id, title, message, type, module, link, reference_type, reference_id, created_by)
    SELECT DISTINCT u.id, p_title, p_message, COALESCE(p_type, 'info'), p_module, p_link,
           p_reference_type, p_reference_id, p_created_by
    FROM public.user_roles ur
    JOIN public.app_users u ON u.id = ur.user_id
    WHERE ur.role = ANY (p_roles)
      AND u.is_active = true
      AND (p_exclude_user IS NULL OR u.id <> p_exclude_user);
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- Mark all of a user's notifications read in one round trip.
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_recipient_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count INTEGER;
BEGIN
    UPDATE public.notifications
    SET is_read = true, read_at = now()
    WHERE recipient_id = p_recipient_id AND is_read = false;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;

-- ============================================================
-- First producer: purchase order awaiting approval
-- ============================================================
-- When a PO enters 'pending_approval', tell everyone who can approve it
-- (purchase managers + admins), except the user who submitted it.
CREATE OR REPLACE FUNCTION public.notify_po_pending_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.status = 'pending_approval'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
        PERFORM public.notify_role(
            ARRAY['purchase_manager', 'admin']::app_role[],
            'Purchase Approval Pending',
            NEW.po_number || ' requires your approval',
            'warning',
            'purchase',
            '/purchase/orders',
            'purchase_order',
            NEW.id,
            NEW.created_by,
            NEW.created_by
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_po_pending_approval
    AFTER INSERT OR UPDATE OF status ON public.purchase_orders
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_po_pending_approval();
