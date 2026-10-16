-- ============================================================
-- Private Label Job Orders: production progress from the floor page
--
-- 1. private_label_job_order_progress: dozens produced per order line,
--    one row per floor entry (negative rows are corrections). Written only
--    through pljo_floor_add_progress(); readable by the office page.
-- 2. private_label_job_orders.production_done_at / _by_name: the floor
--    marks an order's production Done (and can reopen it). The office still
--    Closes the order.
-- 3. PIN-checked floor RPCs:
--    pljo_floor_progress(pin, id)                 lines with ordered / done
--    pljo_floor_add_progress(pin, id, entries, by) entries = [{item_id, dozens}]
--    pljo_floor_set_done(pin, id, done, by)
--    pljo_floor_orders(pin) now also returns done_dozens and production_done_at.
--
-- Rollback: supabase/rollbacks/20261026120000_private_label_floor_progress_down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.private_label_job_order_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.private_label_job_orders(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.private_label_job_order_items(id) ON DELETE CASCADE,
  dozens numeric(14,2) NOT NULL CHECK (dozens <> 0),
  entered_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_progress_order
  ON public.private_label_job_order_progress(job_order_id);
CREATE INDEX IF NOT EXISTS idx_pljo_progress_item
  ON public.private_label_job_order_progress(item_id);

ALTER TABLE public.private_label_job_order_progress ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_private_label_job_order_progress ON public.private_label_job_order_progress;
CREATE POLICY allow_read_private_label_job_order_progress
  ON public.private_label_job_order_progress FOR SELECT USING (true);
REVOKE ALL ON public.private_label_job_order_progress FROM anon, authenticated;
GRANT SELECT ON public.private_label_job_order_progress TO anon, authenticated, service_role;

ALTER TABLE public.private_label_job_orders
  ADD COLUMN IF NOT EXISTS production_done_at timestamptz,
  ADD COLUMN IF NOT EXISTS production_done_by_name text;

-- ------------------------------------------------------------
-- Floor list: add progress
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_floor_orders(p_pin text)
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
          JOIN public.grades g ON g.id = o.grade_id
          LEFT JOIN public.private_label_job_order_attachments logo
            ON logo.job_order_id = o.id AND logo.kind = 'logo'
         WHERE o.status = 'Issued'
      ) x
  ), '[]'::jsonb));
END;
$fn$;

-- ------------------------------------------------------------
-- Progress per line + recent entries
-- ------------------------------------------------------------
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
               'packing_label', coalesce(pt.label, ''),
               'ordered', i.quantity,
               'done', (SELECT coalesce(sum(p.dozens), 0) FROM public.private_label_job_order_progress p
                         WHERE p.item_id = i.id)
             ) ORDER BY i.sort_order)
        FROM public.private_label_job_order_items i
        LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
        LEFT JOIN public.packing_types pt ON pt.id = i.packing_type_id
       WHERE i.job_order_id = p_job_order_id
    ), '[]'::jsonb),
    'entries', coalesce((
      SELECT jsonb_agg(e ORDER BY e.created_at DESC)
        FROM (
          SELECT p.id, p.dozens, p.entered_by_name, p.created_at, coalesce(s.name, '') AS size_name
            FROM public.private_label_job_order_progress p
            JOIN public.private_label_job_order_items i ON i.id = p.item_id
            LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
           WHERE p.job_order_id = p_job_order_id
           ORDER BY p.created_at DESC
           LIMIT 50
        ) e
    ), '[]'::jsonb)
  );
END;
$fn$;

-- ------------------------------------------------------------
-- Add production (one call, several lines)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_floor_add_progress(
  p_pin text, p_job_order_id uuid, p_entries jsonb, p_entered_by text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status text := public.pljo_floor_check_pin(p_pin);
  v_entry jsonb;
  v_item uuid;
  v_dozens numeric;
  v_done numeric;
  v_count integer := 0;
BEGIN
  IF v_status <> 'ok' THEN
    RETURN jsonb_build_object('status', v_status);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.private_label_job_orders
                  WHERE id = p_job_order_id AND status = 'Issued') THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Entries must be a list';
  END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP
    v_item := (v_entry ->> 'item_id')::uuid;
    v_dozens := round((v_entry ->> 'dozens')::numeric, 2);
    CONTINUE WHEN v_dozens IS NULL OR v_dozens = 0;

    IF NOT EXISTS (SELECT 1 FROM public.private_label_job_order_items
                    WHERE id = v_item AND job_order_id = p_job_order_id) THEN
      RAISE EXCEPTION 'Line does not belong to this job order';
    END IF;

    SELECT coalesce(sum(dozens), 0) INTO v_done
      FROM public.private_label_job_order_progress WHERE item_id = v_item;
    IF v_done + v_dozens < 0 THEN
      RAISE EXCEPTION 'A correction cannot take a size below 0 Dz done';
    END IF;

    INSERT INTO public.private_label_job_order_progress (job_order_id, item_id, dozens, entered_by_name)
    VALUES (p_job_order_id, v_item, v_dozens, nullif(trim(p_entered_by), ''));
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'saved', v_count);
END;
$fn$;

-- ------------------------------------------------------------
-- Mark production Done / reopen
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_floor_set_done(
  p_pin text, p_job_order_id uuid, p_done boolean, p_by text)
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

  UPDATE public.private_label_job_orders
     SET production_done_at = CASE WHEN p_done THEN now() END,
         production_done_by_name = CASE WHEN p_done THEN nullif(trim(p_by), '') END
   WHERE id = p_job_order_id AND status = 'Issued';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  RETURN jsonb_build_object('status', 'ok');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.pljo_floor_progress(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_floor_add_progress(text, uuid, jsonb, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_floor_set_done(text, uuid, boolean, text) TO anon, authenticated, service_role;
