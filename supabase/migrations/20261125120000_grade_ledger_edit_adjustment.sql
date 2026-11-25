-- ============================================================================
-- Grade ledger: super-admin edit of a posted stock adjustment
-- ----------------------------------------------------------------------------
-- Adds an edit path for grade_ledger_adjustments. Every edit copies the old
-- values into grade_ledger_adjustment_history first, so nothing is lost.
-- The edit is rejected if it would push any day on/after the blocking date
-- negative for the old or the new bucket/grade (and was not already negative).
-- Clients still cannot write the tables directly; only this function can.
-- ============================================================================

ALTER TABLE public.grade_ledger_adjustments
  ADD COLUMN IF NOT EXISTS updated_by uuid,   -- no FK: keeps app_users embeds unambiguous
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.grade_ledger_adjustment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES public.grade_ledger_adjustments(id) ON DELETE CASCADE,
  old_txn_date date NOT NULL,
  old_bucket text NOT NULL,
  old_grade_id uuid NOT NULL,
  old_quantity numeric NOT NULL,
  old_reason text NOT NULL,
  old_reference text,
  edit_reason text NOT NULL,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS grade_ledger_adjustment_history_idx
  ON public.grade_ledger_adjustment_history (adjustment_id, edited_at);

ALTER TABLE public.grade_ledger_adjustment_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read grade_ledger_adjustment_history" ON public.grade_ledger_adjustment_history;
CREATE POLICY "Read grade_ledger_adjustment_history" ON public.grade_ledger_adjustment_history
  FOR SELECT TO public USING (true);
GRANT SELECT ON public.grade_ledger_adjustment_history TO anon, authenticated, service_role;
GRANT ALL ON public.grade_ledger_adjustment_history TO service_role;

-- Lowest end-of-day balance of a bucket/grade on or after p_from (0 if no rows).
CREATE OR REPLACE FUNCTION public.grade_ledger_min_balance(p_bucket text, p_grade uuid, p_from date)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(MIN(bal), 0) FROM (
    SELECT txn_date, SUM(SUM(qty_in - qty_out)) OVER (ORDER BY txn_date) AS bal
      FROM public.v_grade_ledger_movements
     WHERE bucket = p_bucket AND grade_id = p_grade
     GROUP BY txn_date
  ) d
  WHERE txn_date >= p_from;
$$;

-- Returns the balance of the new bucket/grade at the adjustment date after the edit.
CREATE OR REPLACE FUNCTION public.grade_ledger_edit_adjustment(
  p_id uuid, p_date date, p_bucket text, p_grade uuid, p_quantity numeric,
  p_reason text, p_reference text, p_edit_reason text
) RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := public.app_user_id();
  v_old public.grade_ledger_adjustments%ROWTYPE;
  v_set public.grade_ledger_settings%ROWTYPE;
  v_min_old_before numeric; v_min_new_before numeric;
  v_min_old_after numeric;  v_min_new_after numeric;
  v_from date;
BEGIN
  IF NOT public.grade_ledger_is_super_admin() THEN
    RAISE EXCEPTION 'Only a super admin can edit stock adjustments.';
  END IF;
  SELECT * INTO v_old FROM public.grade_ledger_adjustments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Adjustment not found.';
  END IF;
  SELECT * INTO v_set FROM public.grade_ledger_settings WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Grade ledger is not set up yet.';
  END IF;
  IF p_bucket NOT IN ('COLY','JORR','BALL') THEN
    RAISE EXCEPTION 'Invalid stage.';
  END IF;
  IF p_date IS NULL OR p_date < v_set.cutover_date THEN
    RAISE EXCEPTION 'Date must be on or after the grade ledger cutover date %.', v_set.cutover_date;
  END IF;
  IF p_quantity IS NULL OR p_quantity = 0 THEN
    RAISE EXCEPTION 'Adjustment quantity cannot be zero.';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required for every adjustment.';
  END IF;
  IF p_edit_reason IS NULL OR btrim(p_edit_reason) = '' THEN
    RAISE EXCEPTION 'Please say why this adjustment is being edited.';
  END IF;

  v_from := v_set.block_negative_from;
  v_min_old_before := public.grade_ledger_min_balance(v_old.bucket, v_old.grade_id, v_from);
  v_min_new_before := public.grade_ledger_min_balance(p_bucket, p_grade, v_from);

  INSERT INTO public.grade_ledger_adjustment_history
    (adjustment_id, old_txn_date, old_bucket, old_grade_id, old_quantity, old_reason,
     old_reference, edit_reason, edited_by)
  VALUES (v_old.id, v_old.txn_date, v_old.bucket, v_old.grade_id, v_old.quantity, v_old.reason,
          v_old.reference, btrim(p_edit_reason), v_uid);

  UPDATE public.grade_ledger_adjustments
     SET txn_date = p_date, bucket = p_bucket, grade_id = p_grade, quantity = p_quantity,
         reason = btrim(p_reason), reference = NULLIF(btrim(p_reference), ''),
         updated_by = v_uid, updated_at = now(), edit_count = edit_count + 1
   WHERE id = p_id;

  v_min_old_after := public.grade_ledger_min_balance(v_old.bucket, v_old.grade_id, v_from);
  v_min_new_after := public.grade_ledger_min_balance(p_bucket, p_grade, v_from);

  IF (v_min_old_after < 0 AND v_min_old_after < v_min_old_before)
  OR (v_min_new_after < 0 AND v_min_new_after < v_min_new_before) THEN
    RAISE EXCEPTION 'This edit would make stock negative on a later date (lowest balance %). Nothing was changed.',
      LEAST(v_min_old_after, v_min_new_after);
  END IF;

  RETURN public.grade_ledger_balance(p_bucket, p_grade, p_date);
END;
$$;

GRANT EXECUTE ON FUNCTION
  public.grade_ledger_min_balance(text, uuid, date),
  public.grade_ledger_edit_adjustment(uuid, date, text, uuid, numeric, text, text, text)
TO anon, authenticated, service_role;
