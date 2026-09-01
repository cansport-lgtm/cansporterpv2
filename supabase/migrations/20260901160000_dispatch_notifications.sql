-- Dispatch notifications
--
-- Second producer on the system-notifications infrastructure
-- (20260901150000_system_notifications.sql): whenever a domestic dispatch is
-- made (a row lands in sales_dispatches), notify the management roles below —
-- except the user who made the dispatch, who doesn't need to be told.
--
-- To change WHO gets these, edit the role array in notify_new_dispatch().

CREATE OR REPLACE FUNCTION public.notify_new_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_number TEXT;
    v_customer_name TEXT;
BEGIN
    SELECT so.order_number, c.name
    INTO v_order_number, v_customer_name
    FROM public.sales_orders so
    LEFT JOIN public.customers c ON c.id = so.customer_id
    WHERE so.id = NEW.order_id;

    PERFORM public.notify_role(
        ARRAY['super_admin', 'admin', 'sales_order_manager']::app_role[],
        'Dispatch Made',
        NEW.dispatch_number
            || COALESCE(' — order ' || v_order_number, '')
            || COALESCE(' for ' || v_customer_name, '')
            || COALESCE(', vehicle ' || NULLIF(NEW.vehicle_number, ''), ''),
        'info',
        'sales',
        '/domestic/dispatch',
        'sales_dispatch',
        NEW.id,
        NEW.dispatched_by,
        NEW.dispatched_by
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_dispatch
    AFTER INSERT ON public.sales_dispatches
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_new_dispatch();
