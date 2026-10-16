-- ============================================================
-- Private Label Job Orders: Billing customer
--
-- 1. private_label_job_orders.billing_customer_id: who is invoiced. From the
--    Customers list; when not given it is the order's customer. Existing
--    orders are backfilled with their customer.
-- 2. The change log shows it (pljo_header_view) and an Issued order locks it
--    like the customer (pljo_guard_header).
-- 3. The floor page shows it: pljo_floor_orders gets billing_customer_name,
--    pljo_floor_order_detail gets order.billing_customer.name (for printing).
--
-- The orders table now has two links to customers, so API embeds must name
-- the link: customers!private_label_job_orders_customer_id_fkey(name).
--
-- Rollback: supabase/rollbacks/20261027120000_private_label_billing_customer_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Column + default to the customer
-- ------------------------------------------------------------
ALTER TABLE public.private_label_job_orders
  ADD COLUMN IF NOT EXISTS billing_customer_id uuid
    CONSTRAINT private_label_job_orders_billing_customer_id_fkey
    REFERENCES public.customers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_pljo_billing_customer
  ON public.private_label_job_orders(billing_customer_id);

-- Backfill without the status guard (Closed / Cancelled orders are locked).
ALTER TABLE public.private_label_job_orders DISABLE TRIGGER trg_pljo_guard_header;
UPDATE public.private_label_job_orders
   SET billing_customer_id = customer_id
 WHERE billing_customer_id IS NULL;
ALTER TABLE public.private_label_job_orders ENABLE TRIGGER trg_pljo_guard_header;

ALTER TABLE public.private_label_job_orders ALTER COLUMN billing_customer_id SET NOT NULL;

CREATE OR REPLACE FUNCTION public.pljo_default_billing_customer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.billing_customer_id := coalesce(NEW.billing_customer_id, NEW.customer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_default_billing_customer ON public.private_label_job_orders;
CREATE TRIGGER trg_pljo_default_billing_customer
  BEFORE INSERT OR UPDATE ON public.private_label_job_orders
  FOR EACH ROW EXECUTE FUNCTION public.pljo_default_billing_customer();

-- ------------------------------------------------------------
-- 2. Log view + Issued lock
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_header_view(r public.private_label_job_orders)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'order_date', r.order_date,
    'required_by_date', r.required_by_date,
    'customer', (SELECT name FROM public.customers WHERE id = r.customer_id),
    'billing_customer', (SELECT name FROM public.customers WHERE id = r.billing_customer_id),
    'grade', (SELECT name FROM public.grades WHERE id = r.grade_id),
    'brand_name', r.brand_name,
    'customer_po_ref', r.customer_po_ref,
    'priority', r.priority,
    'status', r.status,
    'remarks', r.remarks,
    'cancel_reason', r.cancel_reason
  );
$$;

CREATE OR REPLACE FUNCTION public.pljo_guard_header()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'Draft' THEN
      RAISE EXCEPTION 'Only a Draft private label job order can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  NEW.pl_job_order_number := OLD.pl_job_order_number;
  NEW.created_by := OLD.created_by;
  NEW.created_at := OLD.created_at;

  IF OLD.status IN ('Closed', 'Cancelled') THEN
    RAISE EXCEPTION '% is % and can no longer be changed', OLD.pl_job_order_number, OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'Draft'  AND NEW.status IN ('Issued', 'Cancelled'))
         OR (OLD.status = 'Issued' AND NEW.status IN ('Closed', 'Cancelled'))) THEN
      RAISE EXCEPTION 'Cannot move % from % to %', OLD.pl_job_order_number, OLD.status, NEW.status;
    END IF;
  END IF;

  IF OLD.status = 'Issued' AND (
       NEW.order_date IS DISTINCT FROM OLD.order_date
    OR NEW.required_by_date IS DISTINCT FROM OLD.required_by_date
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.billing_customer_id IS DISTINCT FROM OLD.billing_customer_id
    OR NEW.grade_id IS DISTINCT FROM OLD.grade_id
    OR NEW.brand_name IS DISTINCT FROM OLD.brand_name
    OR NEW.customer_po_ref IS DISTINCT FROM OLD.customer_po_ref
    OR NEW.priority IS DISTINCT FROM OLD.priority) THEN
    RAISE EXCEPTION '% is Issued: only remarks can be changed', OLD.pl_job_order_number;
  END IF;

  IF NEW.status = 'Issued' AND OLD.status = 'Draft' THEN
    IF NOT EXISTS (SELECT 1 FROM public.private_label_job_order_items WHERE job_order_id = NEW.id) THEN
      RAISE EXCEPTION 'Add at least one line before issuing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.private_label_job_order_attachments
                    WHERE job_order_id = NEW.id AND kind = 'logo') THEN
      RAISE EXCEPTION 'Upload the logo before issuing';
    END IF;
    NEW.issued_at := now();
    NEW.issued_by := v_uid;
  ELSIF NEW.status = 'Closed' AND OLD.status = 'Issued' THEN
    NEW.closed_at := now();
    NEW.closed_by := v_uid;
  ELSIF NEW.status = 'Cancelled' AND OLD.status <> 'Cancelled' THEN
    NEW.cancelled_at := now();
    NEW.cancelled_by := v_uid;
  END IF;

  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 3. Floor page reads
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_floor_orders(p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := public.pljo_floor_check_pin(p_pin);
BEGIN
  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;

  RETURN jsonb_build_object('status', 'ok', 'orders', coalesce((
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.priority_rank, x.required_by_date NULLS LAST, x.pl_job_order_number)
      FROM (
        SELECT o.id,
               o.pl_job_order_number,
               o.order_date,
               o.required_by_date,
               o.brand_name,
               o.customer_po_ref,
               o.priority,
               o.remarks,
               o.issued_at,
               o.production_done_at,
               o.production_done_by_name,
               c.name AS customer_name,
               bc.name AS billing_customer_name,
               g.name AS grade_name,
               CASE o.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS priority_rank,
               (SELECT coalesce(sum(i.quantity), 0) FROM public.private_label_job_order_items i
                 WHERE i.job_order_id = o.id) AS total_dozens,
               (SELECT coalesce(sum(p.dozens), 0) FROM public.private_label_job_order_progress p
                 WHERE p.job_order_id = o.id) AS done_dozens,
               (SELECT count(*) FROM public.private_label_job_order_items i
                 WHERE i.job_order_id = o.id) AS line_count,
               logo.file_path AS logo_path,
               logo.mime_type AS logo_mime,
               (SELECT max(l.changed_at) FROM public.private_label_job_order_log l
                 WHERE l.job_order_id = o.id AND l.action = 'printed') AS last_printed_at
          FROM public.private_label_job_orders o
          JOIN public.customers c ON c.id = o.customer_id
          LEFT JOIN public.customers bc ON bc.id = o.billing_customer_id
          JOIN public.grades g ON g.id = o.grade_id
          LEFT JOIN public.private_label_job_order_attachments logo
            ON logo.job_order_id = o.id AND logo.kind = 'logo'
         WHERE o.status = 'Issued'
      ) x
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.pljo_floor_order_detail(p_pin text, p_job_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text := public.pljo_floor_check_pin(p_pin);
  v_order jsonb;
BEGIN
  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;

  SELECT to_jsonb(o) || jsonb_build_object(
           'customers', jsonb_build_object('name', c.name),
           'billing_customer', jsonb_build_object('name', bc.name),
           'grades', jsonb_build_object('name', g.name))
    INTO v_order
    FROM public.private_label_job_orders o
    JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.customers bc ON bc.id = o.billing_customer_id
    JOIN public.grades g ON g.id = o.grade_id
   WHERE o.id = p_job_order_id AND o.status = 'Issued';

  IF v_order IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'order', v_order,
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', i.id,
               'size_id', i.size_id,
               'quantity', i.quantity,
               'packing_type_id', i.packing_type_id,
               'master_packing_item_id', i.master_packing_item_id,
               'packs_per_master', i.packs_per_master,
               'remarks', coalesce(i.remarks, ''),
               'sort_order', i.sort_order,
               'size_name', coalesce(s.name, ''),
               'packing_label', coalesce(p.label, ''),
               'packing_dozens', coalesce(p.dozens, 0),
               'master_packing_name', coalesce(it.name, '')
             ) ORDER BY i.sort_order)
        FROM public.private_label_job_order_items i
        LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
        LEFT JOIN public.packing_types p ON p.id = i.packing_type_id
        LEFT JOIN public.items it ON it.id = i.master_packing_item_id
       WHERE i.job_order_id = p_job_order_id
    ), '[]'::jsonb),
    'attachments', coalesce((
      SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
        FROM public.private_label_job_order_attachments a
       WHERE a.job_order_id = p_job_order_id
    ), '[]'::jsonb)
  );
END;
$$;
