-- Rollback for 20261028120000_private_label_colors.sql
-- Puts back the function versions from before line colors, then removes the
-- color column and the Color list. Colors chosen on lines are lost.
-- Master packing stays optional: making it required again would fail for
-- lines saved without it.

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

ALTER TABLE public.private_label_job_order_items DROP COLUMN IF EXISTS color_id;
DROP TABLE IF EXISTS public.private_label_colors;
