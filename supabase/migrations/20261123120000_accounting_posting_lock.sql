-- ============================================================
-- Accounting: hard posting lock ("closing date")
--
-- Rule: nobody (super admin included) can create, edit, delete or
-- re-date a voucher or its lines on/before accounting_period_close
-- .closed_through_date. Only a super admin can MOVE the closing date,
-- and moving it backwards / clearing it requires a written reason.
-- Every change is written to accounting_period_close_log.
--
-- Errors are prefixed 'PERIOD_CLOSED:' so the UI can show friendly text.
-- ============================================================

-- ---- 1) Voucher guard: INSERT / UPDATE / DELETE ---------------------------
CREATE OR REPLACE FUNCTION public.enforce_accounting_period_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  closed_date DATE;
BEGIN
  SELECT closed_through_date INTO closed_date FROM public.accounting_period_close WHERE id = 1;
  IF closed_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.voucher_date <= closed_date THEN
      RAISE EXCEPTION 'PERIOD_CLOSED: books are closed through %. Cannot post a voucher dated on or before that date.', closed_date;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.voucher_date <= closed_date THEN
      RAISE EXCEPTION 'PERIOD_CLOSED: books are closed through %. Cannot delete voucher % dated %.', closed_date, OLD.voucher_number, OLD.voucher_date;
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE: neither the old nor the new date may be in the closed period...
  IF OLD.voucher_date <= closed_date OR NEW.voucher_date <= closed_date THEN
    -- ...except the single bookkeeping flip of an old voucher to 'reversed'
    -- once its mirror (reversal) voucher exists. Nothing else may change.
    IF OLD.voucher_date <= closed_date
       AND NEW.voucher_date = OLD.voucher_date
       AND OLD.status IS DISTINCT FROM 'reversed'
       AND NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'updated_at')
       AND EXISTS (SELECT 1 FROM public.accounting_vouchers r WHERE r.reverses_voucher_id = OLD.id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PERIOD_CLOSED: books are closed through %. Voucher % (dated %) cannot be edited or re-dated into the closed period.', closed_date, OLD.voucher_number, OLD.voucher_date;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_accounting_period_close_trg ON public.accounting_vouchers;
CREATE TRIGGER enforce_accounting_period_close_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_vouchers
FOR EACH ROW EXECUTE FUNCTION public.enforce_accounting_period_close();

-- ---- 2) Voucher-line guard ------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_accounting_period_close_lines()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  closed_date DATE;
  v_date DATE;
  v_id UUID;
BEGIN
  SELECT closed_through_date INTO closed_date FROM public.accounting_period_close WHERE id = 1;
  IF closed_date IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Check the parent of the old row (UPDATE/DELETE) and of the new row (INSERT/UPDATE)
  FOR v_id IN
    SELECT DISTINCT x FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.voucher_id END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.voucher_id END
    ]) AS x WHERE x IS NOT NULL
  LOOP
    SELECT voucher_date INTO v_date FROM public.accounting_vouchers WHERE id = v_id;
    IF v_date IS NOT NULL AND v_date <= closed_date THEN
      RAISE EXCEPTION 'PERIOD_CLOSED: books are closed through %. Lines of a voucher dated % cannot be changed.', closed_date, v_date;
    END IF;
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS enforce_accounting_period_close_lines_trg ON public.accounting_voucher_lines;
CREATE TRIGGER enforce_accounting_period_close_lines_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.accounting_voucher_lines
FOR EACH ROW EXECUTE FUNCTION public.enforce_accounting_period_close_lines();

-- ---- 3) Closing-date change log ------------------------------------------
CREATE TABLE IF NOT EXISTS public.accounting_period_close_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  old_closed_through_date DATE,
  new_closed_through_date DATE,
  reason TEXT,
  changed_by UUID REFERENCES public.app_users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.accounting_period_close_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Read accounting_period_close_log" ON public.accounting_period_close_log;
CREATE POLICY "Read accounting_period_close_log"
  ON public.accounting_period_close_log FOR SELECT USING (true);
GRANT SELECT ON public.accounting_period_close_log TO anon, authenticated, service_role;
GRANT INSERT ON public.accounting_period_close_log TO service_role;  -- written only by the trigger below

-- ---- 4) Only super admin may change the closing date; reason rules --------
CREATE OR REPLACE FUNCTION public.guard_accounting_period_close_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := public.app_user_id();
  v_is_admin BOOLEAN := false;
  v_backwards BOOLEAN;
BEGIN
  IF NEW.closed_through_date IS NOT DISTINCT FROM OLD.closed_through_date THEN
    RETURN NEW;  -- no change to the date (e.g. touching notes) -> nothing to guard
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'super_admin')
      INTO v_is_admin;
  ELSIF current_user NOT IN ('anon', 'authenticated') THEN
    v_is_admin := true;  -- migrations / service role / SQL editor
  END IF;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'PERIOD_CLOSED: only a Super Admin can change the accounting closing date.';
  END IF;

  v_backwards := OLD.closed_through_date IS NOT NULL
    AND (NEW.closed_through_date IS NULL OR NEW.closed_through_date < OLD.closed_through_date);

  IF v_backwards AND length(btrim(COALESCE(NEW.notes, ''))) < 5 THEN
    RAISE EXCEPTION 'PERIOD_CLOSED: a reason (min 5 characters) is required to reopen or move the closing date backwards.';
  END IF;

  NEW.last_closed_at := now();
  NEW.last_closed_by := v_uid;
  NEW.updated_at := now();

  INSERT INTO public.accounting_period_close_log
    (old_closed_through_date, new_closed_through_date, reason, changed_by)
  VALUES (OLD.closed_through_date, NEW.closed_through_date, NULLIF(btrim(NEW.notes), ''), v_uid);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_accounting_period_close_change_trg ON public.accounting_period_close;
CREATE TRIGGER guard_accounting_period_close_change_trg
BEFORE UPDATE ON public.accounting_period_close
FOR EACH ROW EXECUTE FUNCTION public.guard_accounting_period_close_change();

-- The single config row can no longer be inserted/deleted from the client.
REVOKE INSERT, DELETE ON public.accounting_period_close FROM anon, authenticated;
