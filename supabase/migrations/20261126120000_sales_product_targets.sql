-- ============================================================
-- Sales targets per product
--
-- One row per product per month (period_month = first day of the month).
-- Targets are in dozens (the unit used on invoices/dispatches) and/or
-- value. Actuals are NOT stored: the Sales Targets page computes them
-- from domestic_invoice_items so they always match the invoices.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sales_product_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  target_qty_dozens NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (target_qty_dozens >= 0),
  target_amount NUMERIC(16,2) NOT NULL DEFAULT 0 CHECK (target_amount >= 0),
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, period_month)
);

CREATE INDEX IF NOT EXISTS idx_sales_product_targets_period ON public.sales_product_targets(period_month DESC);

ALTER TABLE public.sales_product_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sales_product_targets_all" ON public.sales_product_targets;
CREATE POLICY "sales_product_targets_all" ON public.sales_product_targets FOR ALL USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_product_targets TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_sales_product_target_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_sales_product_target ON public.sales_product_targets;
CREATE TRIGGER trg_touch_sales_product_target
  BEFORE UPDATE ON public.sales_product_targets
  FOR EACH ROW EXECUTE FUNCTION public.touch_sales_product_target_updated_at();
