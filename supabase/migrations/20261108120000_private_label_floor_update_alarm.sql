-- ============================================================
-- Private Label / Company Job Orders: 2-hour floor update alarm
--
-- The floor page must update every open order at least every 2 working
-- hours (08:00-20:00); an order that goes longer turns red and sounds an
-- alarm on the floor screen. The clock itself runs in the page.
--
-- 1. private_label_job_order_floor_checkins: a "no progress" check-in from
--    the floor, with a reason (machine down, material waiting, ...). It
--    restarts the 2-hour clock without entering fake dozens.
-- 2. pljo_floor_checkin(pin, id, reason, by): PIN-checked insert.
-- 3. pljo_floor_orders(pin) now also returns last_progress_at / _by,
--    last_checkin_at / _reason / _by and last_activity_at.
--
-- Rollback: supabase/rollbacks/20261108120000_private_label_floor_update_alarm_down.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.private_label_job_order_floor_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_order_id uuid NOT NULL REFERENCES public.private_label_job_orders(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (length(trim(reason)) > 0),
  entered_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_floor_checkins_order
  ON public.private_label_job_order_floor_checkins(job_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pljo_progress_order_created
  ON public.private_label_job_order_progress(job_order_id, created_at DESC);

ALTER TABLE public.private_label_job_order_floor_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_private_label_job_order_floor_checkins ON public.private_label_job_order_floor_checkins;
CREATE POLICY allow_read_private_label_job_order_floor_checkins
  ON public.private_label_job_order_floor_checkins FOR SELECT USING (true);
REVOKE ALL ON public.private_label_job_order_floor_checkins FROM anon, authenticated;
GRANT SELECT ON public.private_label_job_order_floor_checkins TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pljo_floor_checkin(
  p_pin text, p_job_order_id uuid, p_reason text, p_by text)
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
                  WHERE id = p_job_order_id AND status = 'Issued' AND production_done_at IS NULL) THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF nullif(trim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'Choose a reason';
  END IF;

  INSERT INTO public.private_label_job_order_floor_checkins (job_order_id, reason, entered_by_name)
  VALUES (p_job_order_id, left(trim(p_reason), 200), nullif(trim(p_by), ''));
  RETURN jsonb_build_object('status', 'ok');
END;
$fn$;

REVOKE ALL ON FUNCTION public.pljo_floor_checkin(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pljo_floor_checkin(text, uuid, text, text) TO anon, authenticated, service_role;

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
                 WHERE l.job_order_id = o.id AND l.action = 'printed') AS last_printed_at,
               lp.created_at AS last_progress_at,
               lp.entered_by_name AS last_progress_by,
               lc.created_at AS last_checkin_at,
               lc.reason AS last_checkin_reason,
               lc.entered_by_name AS last_checkin_by,
               -- The 2-hour floor update clock runs from the latest of these.
               -- updated_at covers a Reopen from the floor.
               greatest(o.issued_at, o.updated_at, lp.created_at, lc.created_at) AS last_activity_at
          FROM public.private_label_job_orders o
          LEFT JOIN public.customers c ON c.id = o.customer_id
          LEFT JOIN public.customers bc ON bc.id = o.billing_customer_id
          LEFT JOIN public.grades g ON g.id = o.grade_id
          LEFT JOIN public.private_label_job_order_attachments logo
            ON logo.job_order_id = o.id AND logo.kind = 'logo'
          LEFT JOIN LATERAL (
            SELECT p.created_at, p.entered_by_name FROM public.private_label_job_order_progress p
             WHERE p.job_order_id = o.id ORDER BY p.created_at DESC LIMIT 1) lp ON true
          LEFT JOIN LATERAL (
            SELECT k.created_at, k.reason, k.entered_by_name FROM public.private_label_job_order_floor_checkins k
             WHERE k.job_order_id = o.id ORDER BY k.created_at DESC LIMIT 1) lc ON true
         WHERE o.status = 'Issued'
      ) x
  ), '[]'::jsonb));
END;
$$;
