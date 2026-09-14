-- Help Desk module
--
-- Any logged-in user can raise a ticket for system bugs and issues; super
-- admins are notified through the system-notifications infrastructure
-- (20260901150000_system_notifications.sql) and manage tickets at
-- /helpdesk/manage. The requester is notified back when the status changes.

CREATE TABLE public.helpdesk_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(30) NOT NULL DEFAULT 'bug'
    CHECK (category IN ('bug', 'issue', 'feature_request', 'other')),
  priority public.priority_level NOT NULL DEFAULT 'medium',
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  page_or_module VARCHAR(120),
  requested_by UUID NOT NULL REFERENCES public.app_users(id),
  assigned_to UUID REFERENCES public.app_users(id),
  resolution_notes TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.helpdesk_ticket_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES public.helpdesk_tickets(id) ON DELETE CASCADE,
  comment_text TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_helpdesk_tickets_requested_by ON public.helpdesk_tickets (requested_by, created_at DESC);
CREATE INDEX idx_helpdesk_tickets_status ON public.helpdesk_tickets (status, created_at DESC);
CREATE INDEX idx_helpdesk_ticket_comments_ticket ON public.helpdesk_ticket_comments (ticket_id, created_at);

ALTER TABLE public.helpdesk_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helpdesk_ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on helpdesk_tickets"
  ON public.helpdesk_tickets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on helpdesk_ticket_comments"
  ON public.helpdesk_ticket_comments FOR ALL USING (true) WITH CHECK (true);

-- Auto ticket number: HD-YY-00001
CREATE OR REPLACE FUNCTION public.generate_helpdesk_ticket_number()
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_year TEXT;
  v_count INTEGER;
BEGIN
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COUNT(*) + 1 INTO v_count FROM helpdesk_tickets
  WHERE created_at >= DATE_TRUNC('year', CURRENT_DATE);
  RETURN 'HD-' || v_year || '-' || LPAD(v_count::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.set_helpdesk_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := public.generate_helpdesk_ticket_number();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_helpdesk_ticket_number
  BEFORE INSERT ON public.helpdesk_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.set_helpdesk_ticket_number();

CREATE TRIGGER trg_helpdesk_tickets_updated_at
  BEFORE UPDATE ON public.helpdesk_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Notify super admins when a ticket is raised (skipping the requester if
-- they are themselves a super admin).
CREATE OR REPLACE FUNCTION public.notify_new_helpdesk_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester_name TEXT;
BEGIN
  SELECT full_name INTO v_requester_name FROM public.app_users WHERE id = NEW.requested_by;

  PERFORM public.notify_role(
    ARRAY['super_admin']::app_role[],
    'New Help Desk Ticket',
    NEW.ticket_number || ' — ' || NEW.title
      || COALESCE(' (from ' || v_requester_name || ')', ''),
    CASE WHEN NEW.priority IN ('high', 'critical') THEN 'warning' ELSE 'info' END,
    'helpdesk',
    '/helpdesk/manage',
    'helpdesk_ticket',
    NEW.id,
    NEW.requested_by,
    NEW.requested_by
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_helpdesk_ticket
  AFTER INSERT ON public.helpdesk_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_helpdesk_ticket();

-- Notify the requester when their ticket's status changes.
CREATE OR REPLACE FUNCTION public.notify_helpdesk_ticket_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> OLD.status THEN
    PERFORM public.notify_user(
      NEW.requested_by,
      'Help Desk Ticket ' ||
        CASE NEW.status
          WHEN 'in_progress' THEN 'In Progress'
          WHEN 'resolved' THEN 'Resolved'
          WHEN 'closed' THEN 'Closed'
          ELSE 'Updated'
        END,
      NEW.ticket_number || ' — ' || NEW.title,
      CASE WHEN NEW.status = 'resolved' THEN 'success' ELSE 'info' END,
      'helpdesk',
      '/helpdesk',
      'helpdesk_ticket',
      NEW.id,
      NEW.assigned_to
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_helpdesk_ticket_status
  AFTER UPDATE OF status ON public.helpdesk_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_helpdesk_ticket_status();
