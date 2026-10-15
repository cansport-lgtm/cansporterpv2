-- ============================================================
-- Private Label Job Orders: ball color per line, master packing optional
--
-- 1. private_label_colors: the Color list (Peach, Golden, Standard Yellow to
--    start). Colors are switched off, never deleted.
-- 2. private_label_job_order_items.color_id: the color of each size line.
--    Required on the form; lines saved before this change have none.
-- 3. Master packing and packs per master are no longer asked on the form, so
--    both columns become optional. Values already saved are kept.
-- 4. The change log, floor print and floor production dialog show the color.
--
-- Rollback: supabase/rollbacks/20261028120000_private_label_colors_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Color list
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_colors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  swatch text,                       -- hex shown as a dot next to the name
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_private_label_colors_name
  ON public.private_label_colors (lower(trim(name)));

ALTER TABLE public.private_label_colors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_all_private_label_colors ON public.private_label_colors;
CREATE POLICY allow_all_private_label_colors
  ON public.private_label_colors FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_label_colors TO anon, authenticated, service_role;

DROP TRIGGER IF EXISTS update_private_label_colors_updated_at ON public.private_label_colors;
CREATE TRIGGER update_private_label_colors_updated_at
  BEFORE UPDATE ON public.private_label_colors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS audit_row_change ON public.private_label_colors;
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.private_label_colors
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('planning');

INSERT INTO public.private_label_colors (name, swatch, sort_order)
SELECT v.name, v.swatch, v.sort_order
  FROM (VALUES ('Peach', '#f7b08a', 1), ('Golden', '#d4a017', 2), ('Standard Yellow', '#f5d90a', 3))
       AS v(name, swatch, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.private_label_colors c
                    WHERE lower(trim(c.name)) = lower(v.name));

-- ------------------------------------------------------------
-- 2 + 3. Lines
-- ------------------------------------------------------------
ALTER TABLE public.private_label_job_order_items
  ADD COLUMN IF NOT EXISTS color_id uuid
    CONSTRAINT private_label_job_order_items_color_id_fkey
    REFERENCES public.private_label_colors(id) ON DELETE RESTRICT;

ALTER TABLE public.private_label_job_order_items ALTER COLUMN master_packing_item_id DROP NOT NULL;
ALTER TABLE public.private_label_job_order_items ALTER COLUMN packs_per_master DROP NOT NULL;

-- ------------------------------------------------------------
-- 4. Log view, floor print, floor production dialog
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_item_view(r public.private_label_job_order_items)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'size', (SELECT name FROM public.private_label_sizes WHERE id = r.size_id),
    'color', (SELECT name FROM public.private_label_colors WHERE id = r.color_id),
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
               'color_id', i.color_id,
               'quantity', i.quantity,
               'packing_type_id', i.packing_type_id,
               'master_packing_item_id', i.master_packing_item_id,
               'packs_per_master', i.packs_per_master,
               'remarks', coalesce(i.remarks, ''),
               'sort_order', i.sort_order,
               'size_name', coalesce(s.name, ''),
               'color_name', coalesce(col.name, ''),
               'color_swatch', col.swatch,
               'packing_label', coalesce(p.label, ''),
               'packing_dozens', coalesce(p.dozens, 0),
               'master_packing_name', coalesce(it.name, '')
             ) ORDER BY i.sort_order)
        FROM public.private_label_job_order_items i
        LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
        LEFT JOIN public.private_label_colors col ON col.id = i.color_id
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
               'packing_label', coalesce(pt.label, ''),
               'ordered', i.quantity,
               'done', (SELECT coalesce(sum(p.dozens), 0) FROM public.private_label_job_order_progress p
                         WHERE p.item_id = i.id)
             ) ORDER BY i.sort_order)
        FROM public.private_label_job_order_items i
        LEFT JOIN public.private_label_sizes s ON s.id = i.size_id
        LEFT JOIN public.private_label_colors col ON col.id = i.color_id
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
