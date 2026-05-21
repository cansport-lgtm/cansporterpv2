-- ============================================================
-- Sales returns & Purchase returns
--
-- Replaces the simple journal-entry-style screens in /accounting/entries
-- with proper return invoices in the Sales and Purchase modules.
--
-- A sales return references the original dispatch + customer + items.
-- A purchase return references the original GRN + supplier + items.
-- Numbers auto-generate as SRN-YYYYMM-NNNN / PRN-YYYYMM-NNNN.
-- accounting_voucher_id is set after a successful auto-post so the
-- entry can be drilled into from the return page.
-- ============================================================

-- ---------- Sales Returns ----------
CREATE TABLE IF NOT EXISTS public.sales_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT UNIQUE,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  dispatch_id UUID REFERENCES public.sales_dispatches(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  reason TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  cogs_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  notes TEXT,
  accounting_voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.sales_returns(id) ON DELETE CASCADE,
  dispatch_item_id UUID REFERENCES public.sales_dispatch_items(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  quantity_dozens NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  standard_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason TEXT,
  line_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_returns_dispatch ON public.sales_returns(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_customer ON public.sales_returns(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_returns_date ON public.sales_returns(return_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_returns_status ON public.sales_returns(status);
CREATE INDEX IF NOT EXISTS idx_sales_return_items_return ON public.sales_return_items(return_id);

ALTER TABLE public.sales_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sales_returns_all" ON public.sales_returns;
CREATE POLICY "sales_returns_all" ON public.sales_returns FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "sales_return_items_all" ON public.sales_return_items;
CREATE POLICY "sales_return_items_all" ON public.sales_return_items FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_returns TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_return_items TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_sales_return_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix TEXT;
  v_seq INT;
BEGIN
  IF NEW.return_number IS NULL OR NEW.return_number = '' THEN
    v_prefix := 'SRN-' || TO_CHAR(COALESCE(NEW.return_date, CURRENT_DATE), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(CAST(SUBSTRING(return_number FROM LENGTH(v_prefix) + 1) AS INT)), 0) + 1
      INTO v_seq
    FROM public.sales_returns
    WHERE return_number LIKE v_prefix || '%';
    NEW.return_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sales_return_number ON public.sales_returns;
CREATE TRIGGER trg_set_sales_return_number
  BEFORE INSERT ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.set_sales_return_number();

CREATE OR REPLACE FUNCTION public.touch_sales_return_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_sales_return ON public.sales_returns;
CREATE TRIGGER trg_touch_sales_return
  BEFORE UPDATE ON public.sales_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_sales_return_updated_at();


-- ---------- Purchase Returns ----------
CREATE TABLE IF NOT EXISTS public.purchase_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT UNIQUE,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  grn_id UUID REFERENCES public.goods_receipt_notes(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  category TEXT NOT NULL DEFAULT 'raw_material'
    CHECK (category IN ('raw_material', 'office_supplies', 'general_supplies', 'spare_maintenance')),
  reason TEXT,
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'cancelled')),
  notes TEXT,
  accounting_voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchase_return_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES public.purchase_returns(id) ON DELETE CASCADE,
  grn_item_id UUID REFERENCES public.grn_items(id) ON DELETE SET NULL,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  description TEXT,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  reason TEXT,
  line_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_returns_grn ON public.purchase_returns(grn_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_supplier ON public.purchase_returns(supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_date ON public.purchase_returns(return_date DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_returns_status ON public.purchase_returns(status);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_return ON public.purchase_return_items(return_id);

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_return_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_returns_all" ON public.purchase_returns;
CREATE POLICY "purchase_returns_all" ON public.purchase_returns FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "purchase_return_items_all" ON public.purchase_return_items;
CREATE POLICY "purchase_return_items_all" ON public.purchase_return_items FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_returns TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_return_items TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_purchase_return_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_prefix TEXT;
  v_seq INT;
BEGIN
  IF NEW.return_number IS NULL OR NEW.return_number = '' THEN
    v_prefix := 'PRN-' || TO_CHAR(COALESCE(NEW.return_date, CURRENT_DATE), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(CAST(SUBSTRING(return_number FROM LENGTH(v_prefix) + 1) AS INT)), 0) + 1
      INTO v_seq
    FROM public.purchase_returns
    WHERE return_number LIKE v_prefix || '%';
    NEW.return_number := v_prefix || LPAD(v_seq::TEXT, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_purchase_return_number ON public.purchase_returns;
CREATE TRIGGER trg_set_purchase_return_number
  BEFORE INSERT ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.set_purchase_return_number();

CREATE OR REPLACE FUNCTION public.touch_purchase_return_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_purchase_return ON public.purchase_returns;
CREATE TRIGGER trg_touch_purchase_return
  BEFORE UPDATE ON public.purchase_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_purchase_return_updated_at();
