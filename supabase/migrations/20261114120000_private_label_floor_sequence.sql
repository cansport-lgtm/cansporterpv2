-- ============================================================
-- Private Label / Company Job Orders: floor priority sequence
--
-- The floor display used to sort issued orders by the low / medium / high /
-- critical priority label, which leaves ties. This adds an explicit queue
-- (1, 2, 3 ...) over every Issued order, private label and company product
-- orders together, set by the people who issue the orders.
--
-- 1. private_label_floor_sequence: one row per Issued order with its
--    position. A side table, not a column on the header, so reordering
--    never touches updated_at on the header (the floor's 2-hour update
--    clock reads greatest(issued_at, updated_at, ...)) and never fires the
--    header's guard / log / audit triggers.
-- 2. pljo_floor_sequence_sync(): AFTER UPDATE trigger on the header.
--    Draft -> Issued appends the order at the end of the queue;
--    Issued -> Closed / Cancelled removes it and closes the gap.
-- 3. pljo_set_floor_sequence(p_order_ids): the only way to reorder. The
--    caller must hold a role that can issue these orders (planning module),
--    must send exactly the set of Issued orders, and every change is written
--    to private_label_job_order_log as 'sequenced'.
-- 4. pljo_floor_orders(pin) returns floor_sequence and orders by it; the old
--    priority order is only the fallback.
-- 5. Backfill: every Issued order gets a number once, in the old floor order.
--
-- Rollback: supabase/rollbacks/20261114120000_private_label_floor_sequence_down.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sequence table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.private_label_floor_sequence (
  job_order_id uuid PRIMARY KEY REFERENCES public.private_label_job_orders(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq > 0),
  set_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  set_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pljo_floor_sequence_seq ON public.private_label_floor_sequence(seq);

-- Read by everyone (the floor page reads through the PIN RPC, the planning
-- pages embed it); written only by the trigger and the RPC below.
ALTER TABLE public.private_label_floor_sequence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_read_private_label_floor_sequence ON public.private_label_floor_sequence;
CREATE POLICY allow_read_private_label_floor_sequence
  ON public.private_label_floor_sequence FOR SELECT USING (true);
REVOKE ALL ON public.private_label_floor_sequence FROM anon, authenticated;
GRANT SELECT ON public.private_label_floor_sequence TO anon, authenticated, service_role;

-- The log gains the 'sequenced' action.
ALTER TABLE public.private_label_job_order_log
  DROP CONSTRAINT IF EXISTS private_label_job_order_log_action_check;
ALTER TABLE public.private_label_job_order_log
  ADD CONSTRAINT private_label_job_order_log_action_check CHECK (action IN (
    'created', 'updated', 'issued', 'closed', 'cancelled', 'printed',
    'line_added', 'line_changed', 'line_removed',
    'logo_added', 'logo_removed', 'artwork_added', 'artwork_removed',
    'sequenced'
  ));

-- ------------------------------------------------------------
-- 2. Keep the queue in step with the order status
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
    -- Append at the end: a new order never jumps ahead unless someone moves it.
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
      -- Close the gap so the floor never shows "1, 2, 5".
      UPDATE public.private_label_floor_sequence
         SET seq = seq - 1
       WHERE seq > v_old_seq;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pljo_floor_sequence_sync ON public.private_label_job_orders;
CREATE TRIGGER trg_pljo_floor_sequence_sync
  AFTER UPDATE OF status ON public.private_label_job_orders
  FOR EACH ROW EXECUTE FUNCTION public.pljo_floor_sequence_sync();

-- ------------------------------------------------------------
-- 3. Reorder (planning side)
-- ------------------------------------------------------------
-- Who may reorder: the roles that can issue a private label job order
-- (the planning module in src/contexts/AuthContext.tsx).
CREATE OR REPLACE FUNCTION public.pljo_can_sequence(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_uid IS NOT NULL AND (
       public.has_role(p_uid, 'super_admin'::app_role)
    OR public.has_role(p_uid, 'admin'::app_role)
    OR public.has_role(p_uid, 'manager'::app_role)
    OR public.has_role(p_uid, 'production_operator'::app_role)
    OR public.has_role(p_uid, 'closing_data_poster'::app_role)
  );
$$;

-- p_order_ids: every Issued order, in the wanted order. Rewrites the queue as
-- 1..N in one go, so there is never a duplicate or a gap. Refuses if the list
-- does not match the Issued orders (someone issued or closed one meanwhile):
-- the client reloads and tries again rather than overwriting that change.
CREATE OR REPLACE FUNCTION public.pljo_set_floor_sequence(p_order_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_issued integer;
  v_changed integer := 0;
  r record;
BEGIN
  IF NOT public.pljo_can_sequence(v_uid) THEN
    RAISE EXCEPTION 'You do not have rights to set the floor sequence';
  END IF;
  IF p_order_ids IS NULL OR cardinality(p_order_ids) = 0 THEN
    RAISE EXCEPTION 'Nothing to sequence';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_order_ids) x) <> cardinality(p_order_ids) THEN
    RAISE EXCEPTION 'The list has a duplicate order';
  END IF;

  -- Lock the issued orders so two planners cannot save at the same moment.
  PERFORM 1 FROM public.private_label_job_orders WHERE status = 'Issued' FOR UPDATE;

  SELECT count(*) INTO v_issued FROM public.private_label_job_orders WHERE status = 'Issued';
  IF v_issued <> cardinality(p_order_ids)
     OR EXISTS (SELECT 1 FROM unnest(p_order_ids) x
                 WHERE NOT EXISTS (SELECT 1 FROM public.private_label_job_orders o
                                    WHERE o.id = x AND o.status = 'Issued')) THEN
    RAISE EXCEPTION 'The issued orders changed since the list was loaded. Reload and try again.'
      USING ERRCODE = 'serialization_failure';
  END IF;

  FOR r IN
    SELECT n.id, n.seq::integer AS new_seq, s.seq AS old_seq
      FROM unnest(p_order_ids) WITH ORDINALITY AS n(id, seq)
      LEFT JOIN public.private_label_floor_sequence s ON s.job_order_id = n.id
  LOOP
    IF r.old_seq IS DISTINCT FROM r.new_seq THEN
      INSERT INTO public.private_label_floor_sequence (job_order_id, seq, set_by, set_at)
      VALUES (r.id, r.new_seq, v_uid, now())
      ON CONFLICT (job_order_id) DO UPDATE
        SET seq = EXCLUDED.seq, set_by = EXCLUDED.set_by, set_at = EXCLUDED.set_at;
      INSERT INTO public.private_label_job_order_log (job_order_id, action, details, changed_by)
      VALUES (r.id, 'sequenced',
              jsonb_build_object('floor_sequence', jsonb_build_object('old', r.old_seq, 'new', r.new_seq)),
              v_uid);
      v_changed := v_changed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('status', 'ok', 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.pljo_can_sequence(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pljo_set_floor_sequence(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pljo_can_sequence(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pljo_set_floor_sequence(uuid[]) TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 4. Floor page: sequence first
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
    SELECT jsonb_agg(row_to_json(x) ORDER BY x.floor_sequence NULLS LAST, x.priority_rank, x.required_by_date NULLS LAST, x.pl_job_order_number)
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
               fs.seq AS floor_sequence,
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
          LEFT JOIN public.private_label_floor_sequence fs ON fs.job_order_id = o.id
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

-- ------------------------------------------------------------
-- 5. Backfill: number today's issued orders in the old floor order
-- ------------------------------------------------------------
INSERT INTO public.private_label_floor_sequence (job_order_id, seq)
SELECT o.id,
       row_number() OVER (
         ORDER BY CASE o.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                  o.required_by_date NULLS LAST,
                  o.pl_job_order_number)
  FROM public.private_label_job_orders o
 WHERE o.status = 'Issued'
ON CONFLICT (job_order_id) DO NOTHING;
