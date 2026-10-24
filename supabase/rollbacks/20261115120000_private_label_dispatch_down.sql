-- Rollback for 20261115120000_private_label_dispatch.sql
-- Dispatched orders are turned into Closed (keeping dispatched_at as
-- closed_at) before the status check is restored. Also remove the Dispatch
-- buttons from the pages listed in docs/PRIVATE_LABEL_JOB_ORDERS.md ("Dispatch").

DROP FUNCTION IF EXISTS public.pljo_dispatch(uuid, text);

-- pljo_floor_sequence_sync: body from 20261114120000_private_label_floor_sequence.sql
CREATE OR REPLACE FUNCTION public.pljo_floor_sequence_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_seq integer;
BEGIN
  IF NEW.status = 'Issued' AND OLD.status = 'Draft' THEN
    INSERT INTO public.private_label_floor_sequence (job_order_id, seq, set_by)
    VALUES (NEW.id,
            (SELECT coalesce(max(seq), 0) + 1 FROM public.private_label_floor_sequence),
            public.app_user_id())
    ON CONFLICT (job_order_id) DO NOTHING;
  ELSIF OLD.status = 'Issued' AND NEW.status IN ('Closed', 'Cancelled') THEN
    DELETE FROM public.private_label_floor_sequence
     WHERE job_order_id = OLD.id
    RETURNING seq INTO v_old_seq;
    IF v_old_seq IS NOT NULL THEN
      UPDATE public.private_label_floor_sequence
         SET seq = seq - 1
       WHERE seq > v_old_seq;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- pljo_log_header: body from 20261024120000_private_label_job_orders.sql
CREATE OR REPLACE FUNCTION public.pljo_log_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb;
  v_action text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
    VALUES (NEW.id, 'created',
            public.pljo_header_view(NEW) || jsonb_build_object('number', NEW.pl_job_order_number),
            coalesce(public.app_user_id(), NEW.created_by));
    RETURN NEW;
  END IF;

  v_old := public.pljo_header_view(OLD);
  v_new := public.pljo_header_view(NEW);
  v_diff := public.pljo_diff(v_old, v_new, ARRAY['status']);

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_action := CASE NEW.status
      WHEN 'Issued' THEN 'issued'
      WHEN 'Closed' THEN 'closed'
      WHEN 'Cancelled' THEN 'cancelled'
      ELSE 'updated' END;
    v_diff := v_diff || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
  ELSIF v_diff = '{}'::jsonb THEN
    RETURN NEW;
  ELSE
    v_action := 'updated';
  END IF;

  INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
  VALUES (NEW.id, v_action, v_diff, public.app_user_id());
  RETURN NEW;
END;
$$;

-- pljo_guard_header: body from 20261030120000_company_job_orders.sql
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
      RAISE EXCEPTION 'Only a Draft job order can be deleted; cancel it instead';
    END IF;
    RETURN OLD;
  END IF;

  NEW.pl_job_order_number := OLD.pl_job_order_number;
  NEW.order_type := OLD.order_type;
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
    IF OLD.order_type = 'private_label' AND NOT EXISTS (
         SELECT 1 FROM public.private_label_job_order_attachments
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

-- Dispatched orders become Closed (the guard above refuses Dispatched, so
-- the trigger is bypassed for this one data fix).
ALTER TABLE public.private_label_job_orders DISABLE TRIGGER trg_pljo_guard_header;
ALTER TABLE public.private_label_job_orders DISABLE TRIGGER trg_pljo_log_header;
UPDATE public.private_label_job_orders
   SET status = 'Closed', closed_at = coalesce(closed_at, dispatched_at), closed_by = coalesce(closed_by, dispatched_by)
 WHERE status = 'Dispatched';
ALTER TABLE public.private_label_job_orders ENABLE TRIGGER trg_pljo_guard_header;
ALTER TABLE public.private_label_job_orders ENABLE TRIGGER trg_pljo_log_header;

UPDATE public.private_label_job_order_log SET action = 'closed' WHERE action = 'dispatched';
ALTER TABLE public.private_label_job_order_log
  DROP CONSTRAINT IF EXISTS private_label_job_order_log_action_check;
ALTER TABLE public.private_label_job_order_log
  ADD CONSTRAINT private_label_job_order_log_action_check CHECK (action IN (
    'created', 'updated', 'issued', 'closed', 'cancelled', 'printed',
    'line_added', 'line_changed', 'line_removed',
    'logo_added', 'logo_removed', 'artwork_added', 'artwork_removed',
    'sequenced'
  ));

ALTER TABLE public.private_label_job_orders
  DROP COLUMN IF EXISTS dispatched_at,
  DROP COLUMN IF EXISTS dispatched_by,
  DROP COLUMN IF EXISTS dispatch_note;
ALTER TABLE public.private_label_job_orders
  DROP CONSTRAINT IF EXISTS private_label_job_orders_status_check;
ALTER TABLE public.private_label_job_orders
  ADD CONSTRAINT private_label_job_orders_status_check
  CHECK (status IN ('Draft', 'Issued', 'Closed', 'Cancelled'));
