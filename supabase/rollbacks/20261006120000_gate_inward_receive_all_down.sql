-- Rollback for 20261006120000_gate_inward_receive_all.sql
-- Receipts already made at the gate stay (they are ordinary GPR- receipts).

DROP FUNCTION IF EXISTS public.gate_inward_receive_all(uuid);

CREATE OR REPLACE FUNCTION public.gate_pass_can(p_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.gate_pass_has_any_role(CASE p_action
    WHEN 'create'  THEN ARRAY['super_admin','gate_pass_manager','gate_pass_officer']
    WHEN 'approve' THEN ARRAY['super_admin','gate_pass_manager']
    WHEN 'gate'    THEN ARRAY['super_admin','gate_pass_manager','gate_security']
    ELSE ARRAY[]::text[] END);
$$;
