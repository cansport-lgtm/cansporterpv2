-- Goods receiving (GRN) notifications
--
-- Third producer on the system-notifications infrastructure
-- (20260901150000_system_notifications.sql): whenever goods are received (a
-- goods receipt note lands in goods_receipt_notes with a non-draft status),
-- notify the management roles below — except the user who received the goods,
-- who doesn't need to be told. Mirrors the dispatch notifications
-- (20260901160000_dispatch_notifications.sql) on the purchase side.
--
-- The UI creates GRNs directly as 'completed', so the INSERT arm fires today;
-- the UPDATE arm covers any future draft-then-complete flow without
-- re-notifying on later status changes.
--
-- To change WHO gets these, edit the role array in notify_new_grn().

CREATE OR REPLACE FUNCTION public.notify_new_grn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_po_number TEXT;
    v_supplier_name TEXT;
BEGIN
    IF NEW.status <> 'draft'
       AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
        SELECT po.po_number, s.name
        INTO v_po_number, v_supplier_name
        FROM public.purchase_orders po
        LEFT JOIN public.suppliers s ON s.id = NEW.supplier_id
        WHERE po.id = NEW.purchase_order_id;

        PERFORM public.notify_role(
            ARRAY['super_admin', 'admin', 'purchase_manager']::app_role[],
            'Goods Received',
            NEW.grn_number
                || COALESCE(' — PO ' || v_po_number, '')
                || COALESCE(' from ' || v_supplier_name, ''),
            'info',
            'purchase',
            '/purchase/grn',
            'goods_receipt_note',
            NEW.id,
            NEW.received_by,
            NEW.received_by
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_new_grn
    AFTER INSERT OR UPDATE OF status ON public.goods_receipt_notes
    FOR EACH ROW
    EXECUTE FUNCTION public.notify_new_grn();
