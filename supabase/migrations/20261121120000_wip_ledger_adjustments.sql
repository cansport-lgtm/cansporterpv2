-- ============================================================================
-- WIP Ledger: super-admin stock adjustments
-- ----------------------------------------------------------------------------
-- The WIP Ledger page derives every level's balance from production entries,
-- domestic dispatches, sales returns and gate-pass samples since the start.
-- Nothing is stored, so a level that drifts from the physical count stays
-- wrong forever. This adds the one stored document the ledger needs: a signed
-- adjustment (+ adds stock, − removes it) with a mandatory reason.
--
-- An adjustment is anchored to a department, not to a level number: the page
-- resolves the department to its level through production_wip_sequence, so
-- the adjustment stays with its stage if the sequence is renumbered.
--
-- Clients can only read the table. Posting and deleting go through the
-- SECURITY DEFINER functions below, which allow super admins only. There is
-- no edit: a wrong adjustment is deleted or offset by a new one.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.wip_ledger_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_date date NOT NULL,
  department_id uuid NOT NULL REFERENCES public.production_departments(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity <> 0),  -- bags; + adds stock, − removes it
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  reference text,
  created_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wip_ledger_adjustments_idx
  ON public.wip_ledger_adjustments (department_id, txn_date);

ALTER TABLE public.wip_ledger_adjustments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read wip_ledger_adjustments" ON public.wip_ledger_adjustments;
CREATE POLICY "Read wip_ledger_adjustments" ON public.wip_ledger_adjustments
  FOR SELECT TO public USING (true);
GRANT SELECT ON public.wip_ledger_adjustments TO anon, authenticated, service_role;
GRANT ALL ON public.wip_ledger_adjustments TO service_role;

CREATE OR REPLACE FUNCTION public.wip_ledger_add_adjustment(
  p_date date, p_department uuid, p_quantity numeric, p_reason text, p_reference text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_id uuid;
BEGIN
  IF NOT COALESCE(public.has_role(v_uid, 'super_admin'::app_role), false) THEN
    RAISE EXCEPTION 'Only a super admin can post WIP ledger adjustments.';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'An adjustment date is required.';
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero.';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every adjustment.';
  END IF;

  INSERT INTO public.wip_ledger_adjustments
    (txn_date, department_id, quantity, reason, reference, created_by)
  VALUES (p_date, p_department, p_quantity, btrim(p_reason), NULLIF(btrim(p_reference), ''), v_uid)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.wip_ledger_delete_adjustment(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE(public.has_role(public.app_user_id(), 'super_admin'::app_role), false) THEN
    RAISE EXCEPTION 'Only a super admin can delete WIP ledger adjustments.';
  END IF;
  DELETE FROM public.wip_ledger_adjustments WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found.';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.wip_ledger_add_adjustment(date, uuid, numeric, text, text),
  public.wip_ledger_delete_adjustment(uuid)
TO anon, authenticated, service_role;
