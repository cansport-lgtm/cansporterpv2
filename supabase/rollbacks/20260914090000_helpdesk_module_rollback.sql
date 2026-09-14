-- Rollback for 20260914090000_helpdesk_module.sql

DROP TRIGGER IF EXISTS trg_notify_helpdesk_ticket_status ON public.helpdesk_tickets;
DROP FUNCTION IF EXISTS public.notify_helpdesk_ticket_status();
DROP TRIGGER IF EXISTS trg_notify_new_helpdesk_ticket ON public.helpdesk_tickets;
DROP FUNCTION IF EXISTS public.notify_new_helpdesk_ticket();
DROP TRIGGER IF EXISTS trg_helpdesk_tickets_updated_at ON public.helpdesk_tickets;
DROP TRIGGER IF EXISTS trg_set_helpdesk_ticket_number ON public.helpdesk_tickets;
DROP FUNCTION IF EXISTS public.set_helpdesk_ticket_number();
DROP FUNCTION IF EXISTS public.generate_helpdesk_ticket_number();
DROP TABLE IF EXISTS public.helpdesk_ticket_comments;
DROP TABLE IF EXISTS public.helpdesk_tickets;
