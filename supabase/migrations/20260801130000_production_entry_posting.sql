-- ============================================================================
-- Step 2 of the Production → Material Consumption link: posting workflow
-- ----------------------------------------------------------------------------
-- production_entries has carried status ('Draft') / approved_by / approved_at
-- since its creation, but nothing ever wrote them — entries were only guarded
-- by a client-side 48/72h edit window. The consumption sync (step 4) needs a
-- deliberate "this entry is final" event to fire on, so the UI now posts
-- entries: status = 'Posted' with approved_by/approved_at stamped.
--
-- This migration enforces the lock server-side, where the edit window never
-- was: a posted entry's data cannot change and the entry (or its rejection
-- breakdown) cannot be deleted. Only the posting fields themselves may change,
-- so unposting (status back to 'Draft') stays possible from the UI, which
-- gates it behind the production approve permission.
-- ============================================================================

-- Posted entries are read-only except for the posting fields themselves.
CREATE OR REPLACE FUNCTION public.enforce_production_entry_posting_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'Posted' THEN
      RAISE EXCEPTION 'This production entry is posted and locked. Unpost it before deleting.';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'Posted' AND NEW.status = 'Posted' THEN
    IF (to_jsonb(NEW) - 'status' - 'approved_by' - 'approved_at' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'approved_by' - 'approved_at' - 'updated_at') THEN
      RAISE EXCEPTION 'This production entry is posted and locked. Unpost it before editing.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_entry_posting_lock ON public.production_entries;
CREATE TRIGGER trg_production_entry_posting_lock
  BEFORE UPDATE OR DELETE ON public.production_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_production_entry_posting_lock();

-- The rejection breakdown belongs to the entry, so it locks with it.
CREATE OR REPLACE FUNCTION public.enforce_production_rejection_posting_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posted boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.production_entries
     WHERE id IN (
             COALESCE(NEW.production_entry_id, OLD.production_entry_id),
             COALESCE(OLD.production_entry_id, NEW.production_entry_id)
           )
       AND status = 'Posted'
  ) INTO v_posted;

  IF v_posted THEN
    RAISE EXCEPTION 'This production entry is posted and locked. Unpost it before changing its rejection details.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_production_rejection_posting_lock ON public.production_rejections;
CREATE TRIGGER trg_production_rejection_posting_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.production_rejections
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_production_rejection_posting_lock();
