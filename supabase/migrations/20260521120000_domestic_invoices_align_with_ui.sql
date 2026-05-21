-- ============================================================
-- Align domestic_invoices schema with the DomesticInvoicesPage UI
--
-- The original 20260520 migration created the table with:
--   * status CHECK IN ('issued','paid','cancelled')
--   * no due_date, no payment_terms columns
--
-- The UI inserts status='draft', writes due_date + payment_terms, and
-- exposes status transitions through 'sent' and 'overdue'. Without
-- this migration the "Create Invoice" button errors out and the page
-- effectively does nothing.
-- ============================================================

-- Add the columns the page already writes.
ALTER TABLE public.domestic_invoices
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS payment_terms TEXT;

-- Drop the existing narrow status constraint (whatever Postgres named it)
-- and replace it with the expanded set the UI uses.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.domestic_invoices'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.domestic_invoices DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;
END$$;

ALTER TABLE public.domestic_invoices
  ADD CONSTRAINT domestic_invoices_status_check
  CHECK (status IN ('draft', 'sent', 'issued', 'paid', 'overdue', 'cancelled'));

-- New default reflects the UI's create flow: invoices start as draft.
ALTER TABLE public.domestic_invoices
  ALTER COLUMN status SET DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS idx_domestic_invoices_status ON public.domestic_invoices(status);
CREATE INDEX IF NOT EXISTS idx_domestic_invoices_due_date ON public.domestic_invoices(due_date);
