-- ============================================================
-- Private Label Job Orders: PIN-protected floor page (/floor/private-label)
--
-- The floor page has no ERP login. It sends a PIN with every call, and the
-- PIN is checked here, on the server, before any data is returned:
--
-- 1. private_label_floor_settings: one row holding the PIN as a bcrypt hash.
--    No direct table access; the PIN is set only by a super admin through
--    pljo_floor_set_pin().
-- 2. private_label_floor_pin_failures: wrong PINs. 10 wrong PINs within
--    10 minutes lock the floor page for everyone until the window passes,
--    so the PIN cannot be guessed by trying every number. Only wrong PINs
--    since the last PIN change count, so a new PIN starts clean.
-- 3. pljo_floor_orders(pin): Issued orders for the floor list.
--    pljo_floor_order_detail(pin, id): one Issued order, shaped for printing.
--    pljo_floor_log_printed(pin, id): records a floor print in the order log.
--    Each returns {"status": "ok" | "invalid" | "locked" | "not_set", ...}.
--
-- Rollback: supabase/rollbacks/20261025120000_private_label_floor_pin_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. PIN storage
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_floor_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),   -- single row
  pin_hash text NOT NULL,
  pin_changed_at timestamptz NOT NULL DEFAULT now(),
  pin_changed_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL
);

ALTER TABLE public.private_label_floor_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_label_floor_settings FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS public.private_label_floor_pin_failures (
  id bigserial PRIMARY KEY,
  failed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_floor_pin_failures_at
  ON public.private_label_floor_pin_failures(failed_at);

ALTER TABLE public.private_label_floor_pin_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.private_label_floor_pin_failures FROM anon, authenticated;

-- Floor prints carry {"source": "floor"} in details.
-- (The 'printed' action already exists in the log's CHECK list.)

-- ------------------------------------------------------------
-- 2. Set PIN / PIN status (office page)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pljo_floor_set_pin(p_pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can set the floor PIN';
  END IF;
  IF p_pin IS NULL OR p_pin !~ '^[0-9]{4,8}$' THEN
    RAISE EXCEPTION 'The PIN must be 4 to 8 digits';
  END IF;

  INSERT INTO public.private_label_floor_settings (id, pin_hash, pin_changed_at, pin_changed_by)
  VALUES (true, extensions.crypt(p_pin, extensions.gen_salt('bf')), now(), v_uid)
  ON CONFLICT (id) DO UPDATE
    SET pin_hash = EXCLUDED.pin_hash,
        pin_changed_at = EXCLUDED.pin_changed_at,
        pin_changed_by = EXCLUDED.pin_changed_by;
END;
$$;

CREATE OR REPLACE FUNCTION public.pljo_floor_pin_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('is_set', true, 'changed_at', s.pin_changed_at)
       FROM public.private_label_floor_settings s),
    jsonb_build_object('is_set', false)
  );
$$;

-- ------------------------------------------------------------
-- 3. PIN check (internal)
-- ------------------------------------------------------------
-- Returns 'ok', 'invalid', 'locked' or 'not_set'. Records wrong PINs, so the
-- callers below must return (not raise) on failure to keep that row.
CREATE OR REPLACE FUNCTION public.pljo_floor_check_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hash text;
  v_changed timestamptz;
BEGIN
  SELECT pin_hash, pin_changed_at INTO v_hash, v_changed FROM public.private_label_floor_settings;
  IF v_hash IS NULL THEN
    RETURN 'not_set';
  END IF;

  IF (SELECT count(*) FROM public.private_label_floor_pin_failures
       WHERE failed_at > greatest(now() - interval '10 minutes', v_changed)) >= 10 THEN
    RETURN 'locked';
  END IF;

  IF p_pin IS NOT NULL AND v_hash = extensions.crypt(p_pin, v_hash) THEN
    RETURN 'ok';
  END IF;

  INSERT INTO public.private_label_floor_pin_failures DEFAULT VALUES;
  RETURN 'invalid';
END;
$$;

REVOKE ALL ON FUNCTION public.pljo_floor_check_pin(text) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 4. Floor reads / print log
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
               c.name AS customer_name,
               g.name AS grade_name,
               CASE o.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END AS priority_rank,
               (SELECT coalesce(sum(i.quantity), 0) FROM public.private_label_job_order_items i
                 WHERE i.job_order_id = o.id) AS total_dozens,
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
$$;

-- Same shape as the office print (PljoDetail): order, lines, attachments.
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
           'grades', jsonb_build_object('name', g.name))
    INTO v_order
    FROM public.private_label_job_orders o
    JOIN public.customers c ON c.id = o.customer_id
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

CREATE OR REPLACE FUNCTION public.pljo_floor_log_printed(p_pin text, p_job_order_id uuid)
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
  IF NOT EXISTS (SELECT 1 FROM public.private_label_job_orders
                  WHERE id = p_job_order_id AND status = 'Issued') THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
  VALUES (p_job_order_id, 'printed', jsonb_build_object('source', 'floor'), NULL);
  RETURN jsonb_build_object('status', 'ok');
END;
$$;

GRANT EXECUTE ON FUNCTION public.pljo_floor_set_pin(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_floor_pin_status() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_floor_orders(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_floor_order_detail(text, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_floor_log_printed(text, uuid) TO anon, authenticated, service_role;
