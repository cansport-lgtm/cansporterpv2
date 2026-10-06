-- ============================================================
-- Labour Productivity — super admin adjusts advances
--
-- Advances (labour_advances) and travel advances (labour_travel_advances)
-- are deducted from the worker's salary. Until now the only thing stopping
-- a user from changing or deleting one was the UI; the tables were open to
-- every operation and a locked salary month gave no protection at all.
--
-- What this migration does:
--   1. Adds updated_at / updated_by / adjustment_reason to both tables.
--   2. labour_advance_month_locked(date): true when the labour salary for
--      that month is locked (salary_locks, module = 'labour').
--   3. labour_advance_guard(): one BEFORE trigger for both tables.
--        INSERT  — anyone with a login, but never into a locked month.
--                  created_by is filled from the request header.
--        UPDATE  — super admin only, never in a locked month (old or new
--                  date), and a reason of at least 5 characters is required.
--                  updated_at / updated_by are stamped server-side.
--        DELETE  — super admin only, never in a locked month, and only
--                  through labour_advance_delete() so the reason is kept.
--   4. labour_advance_delete(kind, id, reason): writes the reason onto the
--      row and deletes it, so the central audit trail (audit_row_change on
--      both tables, already in place) records the reason with the deletion.
--
-- The acting user comes from app_user_id() (the x-app-user-id header);
-- roles are checked in user_roles through has_role(). Both helpers exist
-- already (super admin audit trail / initial schema migrations).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns
-- ------------------------------------------------------------

ALTER TABLE public.labour_advances
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

ALTER TABLE public.labour_travel_advances
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES public.app_users(id),
  ADD COLUMN IF NOT EXISTS adjustment_reason TEXT;

-- ------------------------------------------------------------
-- 2. Is the labour salary locked for the month of this date?
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.labour_advance_month_locked(p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.salary_locks sl
    WHERE sl.module = 'labour'
      AND sl.lock_month = EXTRACT(MONTH FROM p_date)::int
      AND sl.lock_year  = EXTRACT(YEAR  FROM p_date)::int
  );
$$;

-- ------------------------------------------------------------
-- 3. Guard trigger (shared by both advance tables)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.labour_advance_guard()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    UUID := public.app_user_id();
  v_super  BOOLEAN := public.has_role(v_uid, 'super_admin'::app_role);
  v_label  TEXT := CASE TG_TABLE_NAME
                     WHEN 'labour_travel_advances' THEN 'a travel advance'
                     ELSE 'an advance'
                   END;
  v_reason TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF public.labour_advance_month_locked(NEW.advance_date) THEN
      RAISE EXCEPTION 'Labour salary for % is locked. Unlock it before recording %.',
        to_char(NEW.advance_date, 'FMMonth YYYY'), v_label
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.created_by := COALESCE(NEW.created_by, v_uid);
    NEW.created_at := COALESCE(NEW.created_at, now());
    RETURN NEW;
  END IF;

  -- UPDATE / DELETE: super admin only
  IF NOT v_super THEN
    RAISE EXCEPTION 'Only a super admin can adjust %.', v_label
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.labour_advance_month_locked(OLD.advance_date) THEN
    RAISE EXCEPTION 'Labour salary for % is locked. Unlock it before adjusting %.',
      to_char(OLD.advance_date, 'FMMonth YYYY'), v_label
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.advance_date <> OLD.advance_date
       AND public.labour_advance_month_locked(NEW.advance_date) THEN
      RAISE EXCEPTION 'Labour salary for % is locked. Cannot move % into that month.',
        to_char(NEW.advance_date, 'FMMonth YYYY'), v_label
        USING ERRCODE = 'check_violation';
    END IF;

    -- The identity of the row never changes through an adjustment
    NEW.id          := OLD.id;
    NEW.employee_id := OLD.employee_id;
    NEW.created_at  := OLD.created_at;
    NEW.created_by  := OLD.created_by;

    IF length(trim(COALESCE(NEW.adjustment_reason, ''))) < 5 THEN
      RAISE EXCEPTION 'Give a reason for the adjustment (at least 5 characters).'
        USING ERRCODE = 'check_violation';
    END IF;

    NEW.updated_at := now();
    NEW.updated_by := v_uid;
    RETURN NEW;
  END IF;

  -- DELETE: only through labour_advance_delete(), which sets this flag
  v_reason := current_setting('labour_advance.delete_reason', true);
  IF length(trim(COALESCE(v_reason, ''))) < 5 THEN
    RAISE EXCEPTION 'Delete % through the Adjust dialog and give a reason.', v_label
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS labour_advance_guard ON public.labour_advances;
CREATE TRIGGER labour_advance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.labour_advances
  FOR EACH ROW EXECUTE FUNCTION public.labour_advance_guard();

DROP TRIGGER IF EXISTS labour_advance_guard ON public.labour_travel_advances;
CREATE TRIGGER labour_advance_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.labour_travel_advances
  FOR EACH ROW EXECUTE FUNCTION public.labour_advance_guard();

-- ------------------------------------------------------------
-- 4. Delete with a reason
-- ------------------------------------------------------------

-- p_kind: 'advance' (labour_advances) or 'travel' (labour_travel_advances).
-- Super admin only (the guard trigger enforces it as well). The reason is
-- written onto the row first, so the audit_log 'delete' entry carries it
-- in old_values; then the row is removed.
CREATE OR REPLACE FUNCTION public.labour_advance_delete(p_kind TEXT, p_id UUID, p_reason TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid    UUID := public.app_user_id();
  v_reason TEXT := trim(COALESCE(p_reason, ''));
  v_found  INT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only a super admin can delete an advance.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Give a reason for the deletion (at least 5 characters).'
      USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind NOT IN ('advance', 'travel') THEN
    RAISE EXCEPTION 'Unknown advance kind: %', p_kind USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM set_config('labour_advance.delete_reason', v_reason, true);

  IF p_kind = 'advance' THEN
    UPDATE public.labour_advances
       SET adjustment_reason = v_reason
     WHERE id = p_id;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found = 0 THEN
      RAISE EXCEPTION 'Advance not found.' USING ERRCODE = 'no_data_found';
    END IF;
    DELETE FROM public.labour_advances WHERE id = p_id;
  ELSE
    UPDATE public.labour_travel_advances
       SET adjustment_reason = v_reason
     WHERE id = p_id;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF v_found = 0 THEN
      RAISE EXCEPTION 'Travel advance not found.' USING ERRCODE = 'no_data_found';
    END IF;
    DELETE FROM public.labour_travel_advances WHERE id = p_id;
  END IF;

  PERFORM set_config('labour_advance.delete_reason', '', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.labour_advance_delete(TEXT, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labour_advance_month_locked(DATE) TO anon, authenticated;
