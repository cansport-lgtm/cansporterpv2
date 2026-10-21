-- Rollback for 20261111120000_store_pass_plan_no_reference_only.sql
-- Brings back the plan-number matcher and the plan_matches column of the Link
-- dialog's candidate list. No data changes to undo: links are unaffected.

CREATE OR REPLACE FUNCTION public.store_pass_match_dispatch(p_plan text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT sd.id
    FROM public.sales_dispatches sd
   WHERE sd.sales_segment = 'domestic'
     AND NULLIF(regexp_replace(COALESCE(p_plan, ''), '\D', '', 'g'), '') IS NOT NULL
     AND regexp_replace(sd.dispatch_number, '\D', '', 'g')::bigint
         = regexp_replace(p_plan, '\D', '', 'g')::bigint
     AND upper(regexp_replace(COALESCE(p_plan, ''), '[^A-Za-z]', '', 'g')) IN ('', 'DC')
   ORDER BY sd.created_at DESC
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.store_pass_match_dispatch(text) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.store_pass_link_candidates(uuid);

CREATE FUNCTION public.store_pass_link_candidates(p_dispatch_id uuid)
RETURNS TABLE (
  store_pass_id uuid, pass_number text, status text, pass_date date, dispatch_plan_no text,
  received_by_name text, issued_at timestamptz, created_by_name text,
  quantity numeric, packages numeric, item_count integer,
  linked_count integer, linked_dispatches text, is_current boolean, plan_matches boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH links AS (
    SELECT spd.store_pass_id,
           count(*)::integer AS linked_count,
           string_agg(sd.dispatch_number, ', ' ORDER BY sd.dispatch_number) AS linked_dispatches,
           bool_or(spd.dispatch_id = p_dispatch_id) AS is_current
      FROM public.store_pass_dispatches spd
      JOIN public.sales_dispatches sd ON sd.id = spd.dispatch_id
     GROUP BY spd.store_pass_id
  ), items AS (
    SELECT store_pass_id, sum(quantity) AS quantity, COALESCE(sum(packages), 0) AS packages, count(*)::integer AS item_count
      FROM public.store_pass_items GROUP BY store_pass_id
  )
  SELECT sp.id, sp.pass_number, sp.status, sp.pass_date, sp.dispatch_plan_no,
         sp.received_by_name, sp.issued_at, au.full_name,
         COALESCE(i.quantity, 0), COALESCE(i.packages, 0), COALESCE(i.item_count, 0),
         COALESCE(l.linked_count, 0), l.linked_dispatches, COALESCE(l.is_current, false),
         (public.store_pass_match_dispatch(sp.dispatch_plan_no) = p_dispatch_id)
    FROM public.store_passes sp
    LEFT JOIN links l ON l.store_pass_id = sp.id
    LEFT JOIN items i ON i.store_pass_id = sp.id
    LEFT JOIN public.app_users au ON au.id = sp.created_by
   WHERE sp.status <> 'cancelled'
     AND (l.store_pass_id IS NULL OR l.is_current OR sp.pass_date >= CURRENT_DATE - 7)
   ORDER BY COALESCE(l.is_current, false) DESC,
            (public.store_pass_match_dispatch(sp.dispatch_plan_no) = p_dispatch_id) DESC NULLS LAST,
            (l.store_pass_id IS NULL) DESC,
            sp.pass_date DESC, sp.pass_number DESC;
$$;

GRANT EXECUTE ON FUNCTION public.store_pass_link_candidates(uuid) TO anon, authenticated, service_role;
