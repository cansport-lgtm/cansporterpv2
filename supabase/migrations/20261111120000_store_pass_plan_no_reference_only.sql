-- Store Pass: the dispatch plan number is a reference only.
--
-- The store keeper writes the serial of the paper dispatch plan (1, 2, 3, 12,
-- 52 …) in "Dispatch plan no.". It never was a dispatch (DC) number, so the
-- matcher that read it as one (store_pass_match_dispatch: digits of the plan
-- number = digits of a DC number) could only ever pick the wrong dispatch —
-- plan "52" would match DC-00052, plan "518" DC-00518. It had not linked a
-- single pass since go-live (every link was made by the dispatch operator),
-- but it still drove the Link dialog: the matching pass was flagged "matches
-- this DC", sorted first and pre-ticked, one Save away from a wrong link.
--
-- Now:
--   * store_pass_match_dispatch is dropped;
--   * store_pass_link_candidates no longer returns plan_matches and sorts by
--     the current link, then unlinked passes first, then date — the operator
--     picks the pass by its items and hand-over person;
--   * store_pass_save was already free of the automatic link
--     (20261009130000_store_pass_link_roles.sql); unchanged.
-- The plan number stays on the pass, in the lists and in the Link dialog, as
-- the reference it is.
--
-- Rollback: supabase/rollbacks/20261111120000_store_pass_plan_no_reference_only_down.sql

-- Return type changes (plan_matches goes), so drop and recreate.
DROP FUNCTION IF EXISTS public.store_pass_link_candidates(uuid);

CREATE FUNCTION public.store_pass_link_candidates(p_dispatch_id uuid)
RETURNS TABLE (
  store_pass_id uuid, pass_number text, status text, pass_date date, dispatch_plan_no text,
  received_by_name text, issued_at timestamptz, created_by_name text,
  quantity numeric, packages numeric, item_count integer,
  linked_count integer, linked_dispatches text, is_current boolean
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
         COALESCE(l.linked_count, 0), l.linked_dispatches, COALESCE(l.is_current, false)
    FROM public.store_passes sp
    LEFT JOIN links l ON l.store_pass_id = sp.id
    LEFT JOIN items i ON i.store_pass_id = sp.id
    LEFT JOIN public.app_users au ON au.id = sp.created_by
   WHERE sp.status <> 'cancelled'
     AND (l.store_pass_id IS NULL OR l.is_current OR sp.pass_date >= CURRENT_DATE - 7)
   ORDER BY COALESCE(l.is_current, false) DESC,
            (l.store_pass_id IS NULL) DESC,
            sp.pass_date DESC, sp.pass_number DESC;
$$;

GRANT EXECUTE ON FUNCTION public.store_pass_link_candidates(uuid) TO anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.store_pass_match_dispatch(text);
