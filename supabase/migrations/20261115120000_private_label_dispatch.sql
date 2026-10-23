-- ============================================================
-- Private Label / Company Job Orders: Dispatch
--
-- A new final status "Dispatched" (Issued -> Dispatched). Dispatching takes
-- the order off the floor display and out of the floor sequence (the gap
-- closes), the same as Close / Cancel. Closed stays for orders that end
-- without a dispatch.
--
-- 1. status CHECK gains 'Dispatched'; dispatched_at / dispatched_by /
--    dispatch_note on the header.
-- 2. pljo_guard_header: Issued -> Dispatched allowed; Dispatched is final;
--    stamps dispatched_at / dispatched_by.
-- 3. pljo_log_header: writes 'dispatched' (with the note); log CHECK gains it.
-- 4. pljo_floor_sequence_sync: Dispatched leaves the queue like Closed.
-- 5. pljo_dispatch(id, note): the only way to dispatch. Caller must hold a
--    role that can issue (pljo_can_sequence). Below 100% produced a note is
--    required.
--
-- Rollback: supabase/rollbacks/20261115120000_private_label_dispatch_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Status + columns
-- ------------------------------------------------------------
ALTER TABLE public.private_label_job_orders
  DROP CONSTRAINT IF EXISTS private_label_job_orders_status_check;
ALTER TABLE public.private_label_job_orders
  ADD CONSTRAINT private_label_job_orders_status_check
  CHECK (status IN ('Draft', 'Issued', 'Dispatched', 'Closed', 'Cancelled'));

ALTER TABLE public.private_label_job_orders
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatch_note text;

ALTER TABLE public.private_label_job_order_log
  DROP CONSTRAINT IF EXISTS private_label_job_order_log_action_check;
ALTER TABLE public.private_label_job_order_log
  ADD CONSTRAINT private_label_job_order_log_action_check CHECK (action IN (
    'created', 'updated', 'issued', 'closed', 'cancelled', 'printed',
    'line_added', 'line_changed', 'line_removed',
    'logo_added', 'logo_removed', 'artwork_added', 'artwork_removed',
    'sequenced', 'dispatched'
  ));

-- ------------------------------------------------------------
-- 2. Guard (v4: body from 20261030120000_company_job_orders.sql + Dispatched)
-- ------------------------------------------------------------
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

  IF OLD.status IN ('Dispatched', 'Closed', 'Cancelled') THEN
    RAISE EXCEPTION '% is % and can no longer be changed', OLD.pl_job_order_number, OLD.status;
  END IF;

  -- Allowed moves: Draft -> Issued / Cancelled, Issued -> Dispatched / Closed / Cancelled.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT ((OLD.status = 'Draft'  AND NEW.status IN ('Issued', 'Cancelled'))
         OR (OLD.status = 'Issued' AND NEW.status IN ('Dispatched', 'Closed', 'Cancelled'))) THEN
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

  -- The dispatch note is set only by the dispatch itself.
  IF NEW.status <> 'Dispatched' OR OLD.status = 'Dispatched' THEN
    NEW.dispatch_note := OLD.dispatch_note;
  END IF;
  NEW.dispatched_at := OLD.dispatched_at;
  NEW.dispatched_by := OLD.dispatched_by;

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
  ELSIF NEW.status = 'Dispatched' AND OLD.status = 'Issued' THEN
    NEW.dispatched_at := now();
    NEW.dispatched_by := v_uid;
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
-- 3. Log (v2: body from 20261024120000_private_label_job_orders.sql + dispatched)
-- ------------------------------------------------------------
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
      WHEN 'Dispatched' THEN 'dispatched'
      WHEN 'Closed' THEN 'closed'
      WHEN 'Cancelled' THEN 'cancelled'
      ELSE 'updated' END;
    v_diff := v_diff || jsonb_build_object('status', jsonb_build_object('old', OLD.status, 'new', NEW.status));
    IF NEW.status = 'Dispatched' AND nullif(trim(coalesce(NEW.dispatch_note, '')), '') IS NOT NULL THEN
      v_diff := v_diff || jsonb_build_object('dispatch_note', NEW.dispatch_note);
    END IF;
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

-- ------------------------------------------------------------
-- 4. Floor sequence: Dispatched leaves the queue
-- ------------------------------------------------------------
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
  ELSIF OLD.status = 'Issued' AND NEW.status IN ('Dispatched', 'Closed', 'Cancelled') THEN
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

-- ------------------------------------------------------------
-- 5. Dispatch RPC
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_dispatch(p_job_order_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_order public.private_label_job_orders%ROWTYPE;
  v_total numeric;
  v_done numeric;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF NOT public.pljo_can_sequence(v_uid) THEN
    RAISE EXCEPTION 'You do not have rights to dispatch job orders';
  END IF;

  SELECT * INTO v_order FROM public.private_label_job_orders WHERE id = p_job_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Job order not found';
  END IF;
  IF v_order.status <> 'Issued' THEN
    RAISE EXCEPTION '% is %, only an Issued order can be dispatched', v_order.pl_job_order_number, v_order.status;
  END IF;

  SELECT coalesce(sum(quantity), 0) INTO v_total
    FROM public.private_label_job_order_items WHERE job_order_id = p_job_order_id;
  SELECT coalesce(sum(dozens), 0) INTO v_done
    FROM public.private_label_job_order_progress WHERE job_order_id = p_job_order_id;

  IF v_done < v_total AND v_note IS NULL THEN
    RAISE EXCEPTION 'Only % of % Dz produced: give a note to dispatch anyway', v_done, v_total;
  END IF;

  UPDATE public.private_label_job_orders
     SET status = 'Dispatched',
         dispatch_note = left(v_note, 500)
   WHERE id = p_job_order_id;

  RETURN jsonb_build_object('status', 'ok', 'produced', v_done, 'ordered', v_total);
END;
$$;

REVOKE ALL ON FUNCTION public.pljo_dispatch(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pljo_dispatch(uuid, text) TO anon, authenticated, service_role;
