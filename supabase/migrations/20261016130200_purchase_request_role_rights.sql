-- ============================================================================
-- Purchase Request roles: their rights
-- ----------------------------------------------------------------------------
-- The roles are added in 20261016130100_purchase_request_roles.sql.
--   pr_<category>_approver gives the Purchase approval for its category
--     (purchase_request_can_purchase_approve) and is told when a request of
--     that category waits for Purchase.
--   pr_<category>_officer and _approver are told when a request of their
--     category is approved and ready to order.
-- Reading requests needs no database right (the tables are readable); which
-- requests an officer sees on Purchase → Purchase Requests is the page's filter.
-- Rollback: supabase/rollbacks/20261016130200_purchase_request_role_rights_down.sql
-- ============================================================================

-- The role of a category and tier: ('spare_maintenance', 'approver') → 'pr_spares_approver'.
CREATE OR REPLACE FUNCTION public.purchase_request_category_role(p_category public.purchase_category, p_tier text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT 'pr_' || CASE p_category
      WHEN 'office_supplies' THEN 'office'
      WHEN 'raw_material' THEN 'raw_material'
      WHEN 'general_supplies' THEN 'production'
      WHEN 'spare_maintenance' THEN 'spares'
    END || '_' || p_tier;
$$;

CREATE OR REPLACE FUNCTION public.purchase_request_can_purchase_approve(p_category public.purchase_category)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(ARRAY['super_admin','purchase_manager',
           public.purchase_request_category_role(p_category, 'approver')])
      OR EXISTS (SELECT 1 FROM public.purchase_category_permissions p
                  WHERE p.user_id = public.app_user_id() AND p.category = p_category
                    AND COALESCE(p.can_approve, false));
$$;

-- Notify one stage's audience; never the actor.
--   'requester' the person who raised it
--   'hod'       the heads of its department
--   'purchase'  purchase managers and the category's approvers
--   'final'     super admins
--   'buyers'    purchase officers and managers, and the category's officers
--               and approvers (approved, ready to order)
CREATE OR REPLACE FUNCTION public.purchase_request_notify(
  p_req public.purchase_requests, p_audience text, p_title text, p_message text, p_type text DEFAULT 'info'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_self_link text := '/my-purchase-requests/' || p_req.id::text;
  v_purchase_link text := '/purchase/requests/' || p_req.id::text;
  r record;
BEGIN
  IF p_audience = 'requester' THEN
    IF p_req.created_by IS NOT NULL AND p_req.created_by IS DISTINCT FROM v_uid THEN
      PERFORM public.notify_user(p_req.created_by, p_title, p_message, p_type,
        'purchase', v_self_link, 'purchase_request', p_req.id, v_uid);
    END IF;
  ELSIF p_audience = 'hod' THEN
    FOR r IN
      SELECT h.user_id FROM public.purchase_request_department_heads h
        JOIN public.app_users u ON u.id = h.user_id
       WHERE h.department_id = p_req.department_id AND u.is_active
         AND h.user_id IS DISTINCT FROM v_uid
    LOOP
      PERFORM public.notify_user(r.user_id, p_title, p_message, p_type,
        'purchase', v_self_link, 'purchase_request', p_req.id, v_uid);
    END LOOP;
  ELSIF p_audience = 'purchase' THEN
    FOR r IN
      SELECT DISTINCT u.id AS user_id
        FROM public.app_users u
       WHERE u.is_active AND u.id IS DISTINCT FROM v_uid
         AND u.id IS DISTINCT FROM p_req.created_by
         AND (EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id
                        AND ur.role::text IN ('purchase_manager', public.purchase_request_category_role(p_req.category, 'approver')))
              OR EXISTS (SELECT 1 FROM public.purchase_category_permissions p
                          WHERE p.user_id = u.id AND p.category = p_req.category AND COALESCE(p.can_approve, false)))
    LOOP
      PERFORM public.notify_user(r.user_id, p_title, p_message, p_type,
        'purchase', v_purchase_link, 'purchase_request', p_req.id, v_uid);
    END LOOP;
  ELSIF p_audience = 'final' THEN
    PERFORM public.notify_role(ARRAY['super_admin']::app_role[], p_title, p_message, p_type,
      'purchase', v_purchase_link, 'purchase_request', p_req.id, v_uid, v_uid);
  ELSIF p_audience = 'buyers' THEN
    PERFORM public.notify_role(ARRAY['purchase_officer','purchase_manager',
        public.purchase_request_category_role(p_req.category, 'officer'),
        public.purchase_request_category_role(p_req.category, 'approver')]::app_role[], p_title, p_message, p_type,
      'purchase', v_purchase_link, 'purchase_request', p_req.id, v_uid, v_uid);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.purchase_request_category_role(public.purchase_category, text)
  TO anon, authenticated, service_role;
