-- ============================================================
-- Domestic invoices table
-- Records invoices generated from sales dispatches. Invoice number
-- is auto-generated in INV-YYYYMM-NNNN format via trigger.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.domestic_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE,
  invoice_date DATE NOT NULL DEFAULT CURRENT_DATE,
  dispatch_id UUID REFERENCES public.sales_dispatches(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'paid', 'cancelled')),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domestic_invoices_dispatch ON public.domestic_invoices(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_domestic_invoices_customer ON public.domestic_invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_domestic_invoices_date ON public.domestic_invoices(invoice_date DESC);

ALTER TABLE public.domestic_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "domestic_invoices_select" ON public.domestic_invoices;
CREATE POLICY "domestic_invoices_select" ON public.domestic_invoices FOR SELECT USING (true);

DROP POLICY IF EXISTS "domestic_invoices_insert" ON public.domestic_invoices;
CREATE POLICY "domestic_invoices_insert" ON public.domestic_invoices FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "domestic_invoices_update" ON public.domestic_invoices;
CREATE POLICY "domestic_invoices_update" ON public.domestic_invoices FOR UPDATE USING (true);

DROP POLICY IF EXISTS "domestic_invoices_delete" ON public.domestic_invoices;
CREATE POLICY "domestic_invoices_delete" ON public.domestic_invoices FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.domestic_invoices TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_domestic_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix TEXT;
  v_seq INT;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    v_prefix := 'INV-' || TO_CHAR(COALESCE(NEW.invoice_date, CURRENT_DATE), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(CAST(SUBSTRING(invoice_number FROM LENGTH(v_prefix) + 1) AS INT)), 0) + 1
      INTO v_seq
    FROM public.domestic_invoices
    WHERE invoice_number LIKE v_prefix || '%';
    NEW.invoice_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_domestic_invoice_number ON public.domestic_invoices;
CREATE TRIGGER trg_set_domestic_invoice_number
  BEFORE INSERT ON public.domestic_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_domestic_invoice_number();

CREATE OR REPLACE FUNCTION public.touch_domestic_invoice_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_domestic_invoice ON public.domestic_invoices;
CREATE TRIGGER trg_touch_domestic_invoice
  BEFORE UPDATE ON public.domestic_invoices
  FOR EACH ROW EXECUTE FUNCTION public.touch_domestic_invoice_updated_at();
