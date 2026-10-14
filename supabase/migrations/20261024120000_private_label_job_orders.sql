-- ============================================================
-- Private Label Job Orders (Production Planning)
--
-- A separate job order form for private-label work. It does NOT touch the
-- normal job orders (job_orders / job_order_items / JO-YY-NNNN): own tables,
-- own number series PLJO-YY-NNNN, own page.
--
-- 1. private_label_sizes: the Size list picked on every line.
-- 2. private_label_job_orders: one order = one customer + one grade (ball).
--    Status Draft -> Issued -> Closed, or Cancelled (reason required).
-- 3. private_label_job_order_items: lines of size + qty (dozens) + packing
--    (packing_types) + master packing (an item from the Master Packing
--    material columns on Products / SKUs) and packs per master pack.
-- 4. private_label_job_order_attachments + bucket private-label-logos:
--    the order's logo (required to issue) and any artwork.
-- 5. private_label_job_order_log: append-only change log written by
--    triggers (created, edited, lines, logo, issued, printed, closed,
--    cancelled), plus pljo_log_printed() for print events.
-- 6. Guards: lines and logo can change only while Draft; an Issued order
--    only takes remarks and Close / Cancel; Closed / Cancelled are final.
-- 7. Central audit_log via audit_row_change('planning').
--
-- Rollback: supabase/rollbacks/20261024120000_private_label_job_orders_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Size list
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_private_label_sizes_name
  ON public.private_label_sizes (lower(trim(name)));

ALTER TABLE public.private_label_sizes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_private_label_sizes ON public.private_label_sizes;
CREATE POLICY allow_all_private_label_sizes
  ON public.private_label_sizes FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_label_sizes TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS update_private_label_sizes_updated_at ON public.private_label_sizes;
CREATE TRIGGER update_private_label_sizes_updated_at
  BEFORE UPDATE ON public.private_label_sizes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 2. Header
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_job_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pl_job_order_number text UNIQUE,
  order_date date NOT NULL DEFAULT current_date,
  required_by_date date,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  grade_id uuid NOT NULL REFERENCES public.grades(id) ON DELETE RESTRICT,
  brand_name text,
  customer_po_ref text,
  priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Issued', 'Closed', 'Cancelled')),
  remarks text,
  issued_at timestamptz,
  issued_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  closed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  cancel_reason text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pljo_cancel_reason_required
    CHECK (status <> 'Cancelled' OR nullif(trim(cancel_reason), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pljo_status ON public.private_label_job_orders(status);
CREATE INDEX IF NOT EXISTS idx_pljo_order_date ON public.private_label_job_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_pljo_customer ON public.private_label_job_orders(customer_id);

ALTER TABLE public.private_label_job_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_private_label_job_orders ON public.private_label_job_orders;
CREATE POLICY allow_all_private_label_job_orders
  ON public.private_label_job_orders FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_label_job_orders TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS update_private_label_job_orders_updated_at ON public.private_label_job_orders;
CREATE TRIGGER update_private_label_job_orders_updated_at
  BEFORE UPDATE ON public.private_label_job_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Number series PLJO-YY-NNNN. A counter row per year, bumped atomically, so
-- two people saving at the same moment never get the same number. It rolls
-- back with a failed save, so numbers are only used by saved orders.
CREATE TABLE IF NOT EXISTS public.private_label_job_order_counters (
  yy text PRIMARY KEY,
  last_no integer NOT NULL DEFAULT 0
);
ALTER TABLE public.private_label_job_order_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_label_job_order_counters FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.pljo_assign_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yy text := to_char(coalesce(NEW.order_date, current_date), 'YY');
  v_no integer;
BEGIN
  INSERT INTO public.private_label_job_order_counters AS c (yy, last_no)
  VALUES (v_yy, 1)
  ON CONFLICT (yy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_no;

  NEW.pl_job_order_number := 'PLJO-' || v_yy || '-' || lpad(v_no::text, 4, '0');
  NEW.status := 'Draft';
  NEW.created_by := coalesce(public.app_user_id(), NEW.created_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_assign_number ON public.private_label_job_orders;
CREATE TRIGGER trg_pljo_assign_number
  BEFORE INSERT ON public.private_label_job_orders
  FOR EACH ROW EXECUTE FUNCTION public.pljo_assign_number();

-- ------------------------------------------------------------
-- 3. Lines
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_job_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.private_label_job_orders(id) ON DELETE CASCADE,
  size_id uuid NOT NULL REFERENCES public.private_label_sizes(id) ON DELETE RESTRICT,
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),   -- dozens
  packing_type_id uuid NOT NULL REFERENCES public.packing_types(id) ON DELETE RESTRICT,
  master_packing_item_id uuid NOT NULL REFERENCES public.items(id) ON DELETE RESTRICT,
  packs_per_master numeric(14,2) NOT NULL CHECK (packs_per_master > 0),
  remarks text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_items_order ON public.private_label_job_order_items(job_order_id);

ALTER TABLE public.private_label_job_order_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_private_label_job_order_items ON public.private_label_job_order_items;
CREATE POLICY allow_all_private_label_job_order_items
  ON public.private_label_job_order_items FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_label_job_order_items TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS update_private_label_job_order_items_updated_at ON public.private_label_job_order_items;
CREATE TRIGGER update_private_label_job_order_items_updated_at
  BEFORE UPDATE ON public.private_label_job_order_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ------------------------------------------------------------
-- 4. Logo / artwork attachments + storage bucket
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_job_order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.private_label_job_orders(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'logo' CHECK (kind IN ('logo', 'artwork')),
  file_path text NOT NULL,        -- key in storage.objects (bucket = private-label-logos)
  file_name text NOT NULL,
  file_size integer,
  mime_type text,
  uploaded_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_attachments_order
  ON public.private_label_job_order_attachments(job_order_id);
-- One logo per order; artwork files are unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pljo_one_logo
  ON public.private_label_job_order_attachments(job_order_id) WHERE kind = 'logo';

ALTER TABLE public.private_label_job_order_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_private_label_job_order_attachments ON public.private_label_job_order_attachments;
CREATE POLICY allow_all_private_label_job_order_attachments
  ON public.private_label_job_order_attachments FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_label_job_order_attachments TO anon, authenticated, service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('private-label-logos', 'private-label-logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "private_label_logos_storage_read" ON storage.objects;
CREATE POLICY "private_label_logos_storage_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'private-label-logos');
DROP POLICY IF EXISTS "private_label_logos_storage_insert" ON storage.objects;
CREATE POLICY "private_label_logos_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'private-label-logos');
DROP POLICY IF EXISTS "private_label_logos_storage_delete" ON storage.objects;
CREATE POLICY "private_label_logos_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'private-label-logos');

-- ------------------------------------------------------------
-- 5. Change log
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_job_order_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.private_label_job_orders(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'created', 'updated', 'issued', 'closed', 'cancelled', 'printed',
    'line_added', 'line_changed', 'line_removed',
    'logo_added', 'logo_removed', 'artwork_added', 'artwork_removed'
  )),
  -- {field: {"old": .., "new": ..}} for edits; a snapshot for added / removed rows.
  details jsonb,
  changed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_log_order
  ON public.private_label_job_order_log(job_order_id, changed_at DESC);

-- Read-only from the app; rows come only from the triggers / RPC below.
ALTER TABLE public.private_label_job_order_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_private_label_job_order_log ON public.private_label_job_order_log;
CREATE POLICY allow_read_private_label_job_order_log
  ON public.private_label_job_order_log FOR SELECT USING (true);
GRANT SELECT ON public.private_label_job_order_log TO anon, authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.private_label_job_order_log FROM anon, authenticated;

-- Changed fields only, as {field: {old, new}}.
CREATE OR REPLACE FUNCTION public.pljo_diff(p_old jsonb, p_new jsonb, p_skip text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(jsonb_object_agg(k, jsonb_build_object('old', p_old -> k, 'new', p_new -> k)), '{}'::jsonb)
    FROM (SELECT jsonb_object_keys(p_old || p_new) AS k) keys
   WHERE NOT (k = ANY (p_skip))
     AND (p_old -> k) IS DISTINCT FROM (p_new -> k);
$$;

-- Readable header values: names next to ids so the log makes sense later.
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
    'grade', (SELECT name FROM public.grades WHERE id = r.grade_id),
    'brand_name', r.brand_name,
    'customer_po_ref', r.customer_po_ref,
    'priority', r.priority,
    'status', r.status,
    'remarks', r.remarks,
    'cancel_reason', r.cancel_reason
  );
$$;

CREATE OR REPLACE FUNCTION public.pljo_item_view(r public.private_label_job_order_items)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'size', (SELECT name FROM public.private_label_sizes WHERE id = r.size_id),
    'quantity', r.quantity,
    'packing', (SELECT label FROM public.packing_types WHERE id = r.packing_type_id),
    'master_packing', (SELECT name FROM public.items WHERE id = r.master_packing_item_id),
    'packs_per_master', r.packs_per_master,
    'remarks', r.remarks
  );
$$;

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

DROP TRIGGER IF EXISTS trg_pljo_log_header ON public.private_label_job_orders;
CREATE TRIGGER trg_pljo_log_header
  AFTER INSERT OR UPDATE ON public.private_label_job_orders
  FOR EACH ROW EXECUTE FUNCTION public.pljo_log_header();

CREATE OR REPLACE FUNCTION public.pljo_log_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diff jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
    VALUES (NEW.job_order_id, 'line_added', public.pljo_item_view(NEW), public.app_user_id());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_diff := public.pljo_diff(public.pljo_item_view(OLD), public.pljo_item_view(NEW), ARRAY[]::text[]);
    IF v_diff <> '{}'::jsonb THEN
      INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
      VALUES (NEW.job_order_id, 'line_changed',
              v_diff || jsonb_build_object('line', public.pljo_item_view(NEW) -> 'size'),
              public.app_user_id());
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE: skip when the whole order is being deleted (cascade).
  IF EXISTS (SELECT 1 FROM public.private_label_job_orders WHERE id = OLD.job_order_id) THEN
    INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
    VALUES (OLD.job_order_id, 'line_removed', public.pljo_item_view(OLD), public.app_user_id());
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_log_item ON public.private_label_job_order_items;
CREATE TRIGGER trg_pljo_log_item
  AFTER INSERT OR UPDATE OR DELETE ON public.private_label_job_order_items
  FOR EACH ROW EXECUTE FUNCTION public.pljo_log_item();

-- The uploader is always the acting ERP user.
CREATE OR REPLACE FUNCTION public.pljo_attachment_set_uploader()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.uploaded_by := coalesce(public.app_user_id(), NEW.uploaded_by);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_attachment_uploader ON public.private_label_job_order_attachments;
CREATE TRIGGER trg_pljo_attachment_uploader
  BEFORE INSERT ON public.private_label_job_order_attachments
  FOR EACH ROW EXECUTE FUNCTION public.pljo_attachment_set_uploader();

CREATE OR REPLACE FUNCTION public.pljo_log_attachment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
    VALUES (NEW.job_order_id, NEW.kind || '_added',
            jsonb_build_object('file_name', NEW.file_name), public.app_user_id());
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.private_label_job_orders WHERE id = OLD.job_order_id) THEN
    INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
    VALUES (OLD.job_order_id, OLD.kind || '_removed',
            jsonb_build_object('file_name', OLD.file_name), public.app_user_id());
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_log_attachment ON public.private_label_job_order_attachments;
CREATE TRIGGER trg_pljo_log_attachment
  AFTER INSERT OR DELETE ON public.private_label_job_order_attachments
  FOR EACH ROW EXECUTE FUNCTION public.pljo_log_attachment_change();

-- Print events come from the browser, so they go through this RPC.
CREATE OR REPLACE FUNCTION public.pljo_log_printed(p_job_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.private_label_job_orders WHERE id = p_job_order_id) THEN
    RAISE EXCEPTION 'Private label job order not found';
  END IF;
  INSERT INTO public.private_label_job_order_log (job_order_id, action, changed_by)
  VALUES (p_job_order_id, 'printed', public.app_user_id());
END;
$$;

GRANT EXECUTE ON FUNCTION public.pljo_log_printed(uuid) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 6. Guards (status rules)
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

  -- Allowed moves: Draft -> Issued / Cancelled, Issued -> Closed / Cancelled.
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

DROP TRIGGER IF EXISTS trg_pljo_guard_header ON public.private_label_job_orders;
CREATE TRIGGER trg_pljo_guard_header
  BEFORE UPDATE OR DELETE ON public.private_label_job_orders
  FOR EACH ROW EXECUTE FUNCTION public.pljo_guard_header();

-- Lines and attachments change only while the order is Draft.
CREATE OR REPLACE FUNCTION public.pljo_guard_child()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_order_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.job_order_id ELSE NEW.job_order_id END;
  v_status text;
  v_number text;
BEGIN
  SELECT status, pl_job_order_number INTO v_status, v_number
    FROM public.private_label_job_orders WHERE id = v_order_id;
  -- Parent already gone: this is the cascade of deleting a Draft order.
  IF v_status IS NOT NULL AND v_status <> 'Draft' THEN
    RAISE EXCEPTION '% is %: lines and logo can only change while Draft', v_number, v_status;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.job_order_id IS DISTINCT FROM OLD.job_order_id THEN
    RAISE EXCEPTION 'A line or file cannot be moved to another job order';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_guard_items ON public.private_label_job_order_items;
CREATE TRIGGER trg_pljo_guard_items
  BEFORE INSERT OR UPDATE OR DELETE ON public.private_label_job_order_items
  FOR EACH ROW EXECUTE FUNCTION public.pljo_guard_child();

DROP TRIGGER IF EXISTS trg_pljo_guard_attachments ON public.private_label_job_order_attachments;
CREATE TRIGGER trg_pljo_guard_attachments
  BEFORE INSERT OR UPDATE OR DELETE ON public.private_label_job_order_attachments
  FOR EACH ROW EXECUTE FUNCTION public.pljo_guard_child();

-- ------------------------------------------------------------
-- 7. Central audit trail
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'private_label_job_orders',
    'private_label_job_order_items',
    'private_label_job_order_attachments',
    'private_label_sizes'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.audit_row_change(%L)', t, 'planning');
  END LOOP;
END $$;
