-- ============================================================
-- Company Product Job Orders (Production Planning)
--
-- Job orders for our own sellable products, kept in the Private Label Job
-- Order tables so status rules, the change log, the floor PIN, floor
-- progress, auto-Done and printing all work the same way.
--
-- 1. private_label_job_orders.order_type: 'private_label' (default, every
--    existing order) or 'company'. Set on insert, never changed.
--    A company order has no customer, billing customer or header grade (the
--    grade comes from each product); a private label order still needs all
--    three.
-- 2. Own number series CJO-YY-NNNN (counter rows keyed 'CJO-YY').
-- 3. private_label_job_order_items.product_id: a company line is
--    product + qty (dozens) + packing. The product must be an active own
--    (company) product whose planning item is in a sellable stock category
--    (standard / final_ball; no planning item counts as standard).
--    Private label lines keep size (+ color) and take no product.
-- 4. Issuing a company order needs no logo.
-- 5. Change log names the product on lines.
-- 6. Floor RPCs return order_type and product names; customer and grade
--    joins become LEFT JOINs.
--
-- Rollback: supabase/rollbacks/20261030120000_company_job_orders_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Header: order type, optional customer / grade for company orders
-- ------------------------------------------------------------
ALTER TABLE public.private_label_job_orders
  ADD COLUMN IF NOT EXISTS order_type text NOT NULL DEFAULT 'private_label';

ALTER TABLE public.private_label_job_orders DROP CONSTRAINT IF EXISTS pljo_order_type_check;
ALTER TABLE public.private_label_job_orders
  ADD CONSTRAINT pljo_order_type_check CHECK (order_type IN ('private_label', 'company'));

ALTER TABLE public.private_label_job_orders ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.private_label_job_orders ALTER COLUMN billing_customer_id DROP NOT NULL;
ALTER TABLE public.private_label_job_orders ALTER COLUMN grade_id DROP NOT NULL;

ALTER TABLE public.private_label_job_orders DROP CONSTRAINT IF EXISTS pljo_order_type_fields;
ALTER TABLE public.private_label_job_orders
  ADD CONSTRAINT pljo_order_type_fields CHECK (
    (order_type = 'private_label'
       AND customer_id IS NOT NULL AND billing_customer_id IS NOT NULL AND grade_id IS NOT NULL)
    OR (order_type = 'company' AND customer_id IS NULL AND billing_customer_id IS NULL)
  );

CREATE INDEX IF NOT EXISTS idx_pljo_order_type ON public.private_label_job_orders(order_type);

-- ------------------------------------------------------------
-- 2. Number series: PLJO-YY-NNNN or CJO-YY-NNNN
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_assign_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yy text := to_char(coalesce(NEW.order_date, current_date), 'YY');
  v_prefix text := CASE WHEN NEW.order_type = 'company' THEN 'CJO' ELSE 'PLJO' END;
  -- Private label keeps its existing counter rows ('YY').
  v_key text := CASE WHEN NEW.order_type = 'company' THEN 'CJO-' || v_yy ELSE v_yy END;
  v_no integer;
BEGIN
  INSERT INTO public.private_label_job_order_counters AS c (yy, last_no)
  VALUES (v_key, 1)
  ON CONFLICT (yy) DO UPDATE SET last_no = c.last_no + 1
  RETURNING last_no INTO v_no;

  NEW.pl_job_order_number := v_prefix || '-' || v_yy || '-' || lpad(v_no::text, 4, '0');
  NEW.status := 'Draft';
  NEW.created_by := coalesce(public.app_user_id(), NEW.created_by);
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 3. Lines: product for company orders
-- ------------------------------------------------------------
ALTER TABLE public.private_label_job_order_items
  ADD COLUMN IF NOT EXISTS product_id uuid
    CONSTRAINT private_label_job_order_items_product_id_fkey
    REFERENCES public.products(id) ON DELETE RESTRICT;

ALTER TABLE public.private_label_job_order_items ALTER COLUMN size_id DROP NOT NULL;

ALTER TABLE public.private_label_job_order_items DROP CONSTRAINT IF EXISTS pljo_item_size_or_product;
ALTER TABLE public.private_label_job_order_items
  ADD CONSTRAINT pljo_item_size_or_product CHECK (size_id IS NOT NULL OR product_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_pljo_items_product ON public.private_label_job_order_items(product_id);

-- A line must match its order's type; a company line must be a sellable own product.
CREATE OR REPLACE FUNCTION public.pljo_check_item()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_type text;
BEGIN
  SELECT order_type INTO v_type FROM public.private_label_job_orders WHERE id = NEW.job_order_id;

  IF v_type = 'company' THEN
    IF NEW.product_id IS NULL THEN
      RAISE EXCEPTION 'Select the product on every line';
    END IF;
    NEW.size_id := NULL;
    NEW.color_id := NULL;
    IF NOT EXISTS (
         SELECT 1
           FROM public.products p
           LEFT JOIN public.planning_items pli ON pli.id = p.planning_item_id
          WHERE p.id = NEW.product_id
            AND p.owner_type = 'own'
            AND coalesce(p.is_active, true)
            AND coalesce(pli.stock_category, 'standard') IN ('standard', 'final_ball')) THEN
      RAISE EXCEPTION 'Only active company products in a sellable stock category (Standard / Final Ball) can be ordered';
    END IF;
  ELSIF v_type = 'private_label' THEN
    IF NEW.size_id IS NULL THEN
      RAISE EXCEPTION 'Select the size on every line';
    END IF;
    NEW.product_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_check_item ON public.private_label_job_order_items;
CREATE TRIGGER trg_pljo_check_item
  BEFORE INSERT OR UPDATE ON public.private_label_job_order_items
  FOR EACH ROW EXECUTE FUNCTION public.pljo_check_item();

-- ------------------------------------------------------------
-- 4. Guard: order type is fixed; company orders issue without a logo
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

-- ------------------------------------------------------------
-- 5. Change log: product on lines
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_item_view(r public.private_label_job_order_items)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'product', (SELECT code || ' — ' || name FROM public.products WHERE id = r.product_id),
    'size', (SELECT name FROM public.private_label_sizes WHERE id = r.size_id),
    'color', (SELECT name FROM public.private_label_colors WHERE id = r.color_id),
    'quantity', r.quantity,
    'packing', (SELECT label FROM public.packing_types WHERE id = r.packing_type_id),
    'master_packing', (SELECT name FROM public.items WHERE id = r.master_packing_item_id),
    'packs_per_master', r.packs_per_master,
    'remarks', r.remarks
  ));
$$;

CREATE OR REPLACE FUNCTION public.pljo_log_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_diff jsonb;
  v_view jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
    VALUES (NEW.job_order_id, 'line_added', public.pljo_item_view(NEW), public.app_user_id());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_view := public.pljo_item_view(NEW);
    v_diff := public.pljo_diff(public.pljo_item_view(OLD), v_view, ARRAY[]::text[]);
    IF v_diff <> '{}'::jsonb THEN
      INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
      VALUES (NEW.job_order_id, 'line_changed',
              v_diff || jsonb_build_object('line', coalesce(v_view -> 'size', v_view -> 'product')),
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

-- ------------------------------------------------------------
-- 6. Floor RPCs
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
               o.order_type,
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
               -- Company orders: the grades of their products.
               coalesce(g.name, (
                 SELECT string_agg(DISTINCT pg.name, ', ')
                   FROM public.private_label_job_order_items i
                   JOIN public.products pr ON pr.id = i.product_id
                   JOIN public.grades pg ON pg.id = pr.grade_id
                  WHERE i.job_order_id = o.id)) AS grade_name,
               (SELECT string_agg(pr.name, ', ' ORDER BY i.sort_order)
                  FROM public.private_label_job_order_items i
                  JOIN public.products pr ON pr.id = i.product_id
                 WHERE i.job_order_id = o.id) AS product_names,
               (SELECT string_agg(pr.code, ' ' ORDER BY i.sort_order)
                  FROM public.private_label_job_order_items i
                  JOIN public.products pr ON pr.id = i.product_id
                 WHERE i.job_order_id = o.id) AS product_codes,
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
          LEFT JOIN public.customers c ON c.id = o.customer_id
          LEFT JOIN public.customers bc ON bc.id = o.billing_customer_id
          LEFT JOIN public.grades g ON g.id = o.grade_id
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
           'customers', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object('name', c.name) END,
           'billing_customer', CASE WHEN bc.id IS NULL THEN NULL ELSE jsonb_build_object('name', bc.name) END,
           'grades', CASE WHEN g.id IS NULL THEN NULL ELSE jsonb_build_object('name', g.name) END)
    INTO v_order
    FROM public.private_label_job_orders o
    LEFT JOIN public.customers c ON c.id = o.customer_id
    LEFT JOIN public.customers bc ON bc.id = o.billing_customer_id
    LEFT JOIN public.grades g ON g.id = o.grade_id
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
               'color_id', i.color_id,
               'product_id', i.product_id,
               'quantity', i.quantity,
               'packing_type_id', i.packing_type_id,
               'master_packing_item_id', i.master_packing_item_id,
               'packs_per_master', i.packs_per_master,
               'remarks', coalesce(i.remarks, ''),
               'sort_order', i.sort_order,
               'size_name', coalesce(s.name, ''),
               'color_name', coalesce(col.name, ''),
               'color_swatch', col.swatch,
               'product_code', coalesce(pr.code, ''),
               'product_name', coalesce(pr.name, ''),
               'product_grade', coalesce(pg.name, ''),
               'packing_label', coalesce(p.label, ''),
               'packing_dozens', coalesce(p.dozens, 0),
               'master_packing_name', coalesce(it.name, '')
             ) ORDER BY i.sort_order)
        FROM public.private_label_job_order_items i
        LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
        LEFT JOIN public.private_label_colors col ON col.id = i.color_id
        LEFT JOIN public.products pr ON pr.id = i.product_id
        LEFT JOIN public.grades pg ON pg.id = pr.grade_id
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

CREATE OR REPLACE FUNCTION public.pljo_floor_progress(p_pin text, p_job_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status text := public.pljo_floor_check_pin(p_pin);
BEGIN
  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.private_label_job_orders
                  WHERE id = p_job_order_id AND status = 'Issued') THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'lines', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'item_id', i.id,
               'size_name', coalesce(s.name, ''),
               'color_name', coalesce(col.name, ''),
               'product_code', coalesce(pr.code, ''),
               'product_name', coalesce(pr.name, ''),
               'packing_label', coalesce(pt.label, ''),
               'ordered', i.quantity,
               'done', (SELECT coalesce(sum(p.dozens), 0) FROM public.private_label_job_order_progress p
                         WHERE p.item_id = i.id)
             ) ORDER BY i.sort_order)
        FROM public.private_label_job_order_items i
        LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
        LEFT JOIN public.private_label_colors col ON col.id = i.color_id
        LEFT JOIN public.products pr ON pr.id = i.product_id
        LEFT JOIN public.packing_types pt ON pt.id = i.packing_type_id
       WHERE i.job_order_id = p_job_order_id
    ), '[]'::jsonb),
    'entries', coalesce((
      SELECT jsonb_agg(e ORDER BY e.created_at DESC)
        FROM (
          -- size_name is the line's label: the size, or the product on company orders.
          SELECT p.id, p.dozens, p.entered_by_name, p.created_at,
                 coalesce(s.name, pr.name, '') AS size_name
            FROM public.private_label_job_order_progress p
            JOIN public.private_label_job_order_items i ON i.id = p.item_id
            LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
            LEFT JOIN public.products pr ON pr.id = i.product_id
           WHERE p.job_order_id = p_job_order_id
           ORDER BY p.created_at DESC
           LIMIT 50
        ) e
    ), '[]'::jsonb)
  );
END;
$fn$;

