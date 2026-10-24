-- Rollback for 20261114120000_private_label_floor_sequence.sql
-- Restores pljo_floor_orders (body from 20261108120000_private_label_floor_update_alarm.sql),
-- drops the reorder RPC, the status trigger and the sequence table, and takes
-- 'sequenced' back out of the log actions (its rows are deleted first).
-- Also remove the sequence badge / dialog from the pages listed in
-- docs/PRIVATE_LABEL_JOB_ORDERS.md ("Floor sequence").

DROP TRIGGER IF EXISTS trg_pljo_floor_sequence_sync ON public.private_label_job_orders;
DROP FUNCTION IF EXISTS public.pljo_floor_sequence_sync();
DROP FUNCTION IF EXISTS public.pljo_set_floor_sequence(uuid[]);
DROP FUNCTION IF EXISTS public.pljo_can_sequence(uuid);
DROP TABLE IF EXISTS public.private_label_floor_sequence;

DELETE FROM public.private_label_job_order_log WHERE action = 'sequenced';
ALTER TABLE public.private_label_job_order_log
  DROP CONSTRAINT IF EXISTS private_label_job_order_log_action_check;
ALTER TABLE public.private_label_job_order_log
  ADD CONSTRAINT private_label_job_order_log_action_check CHECK (action IN (
    'created', 'updated', 'issued', 'closed', 'cancelled', 'printed',
    'line_added', 'line_changed', 'line_removed',
    'logo_added', 'logo_removed', 'artwork_added', 'artwork_removed'
  ));

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
