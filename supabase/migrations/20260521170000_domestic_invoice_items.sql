-- ============================================================
-- Domestic invoice line items
--
-- domestic_invoices previously had no items of its own — line data was
-- read on the fly from sales_dispatch_items at print/view time. That
-- made the invoice non-editable: you couldn't override a customer-facing
-- price or quantity without rebuilding the dispatch.
--
-- This snapshots the items at invoice-creation time into a dedicated
-- table so the invoice is a fully independent, editable document.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.domestic_invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.domestic_invoices(id) ON DELETE CASCADE,
  dispatch_item_id UUID REFERENCES public.sales_dispatch_items(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  description TEXT,
  grade_name TEXT,
  packing_type TEXT,
  quantity_dozens NUMERIC(12,2) NOT NULL DEFAULT 0,
  price_per_dozen NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  line_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_domestic_invoice_items_invoice ON public.domestic_invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_domestic_invoice_items_dispatch ON public.domestic_invoice_items(dispatch_item_id);
CREATE INDEX IF NOT EXISTS idx_domestic_invoice_items_product ON public.domestic_invoice_items(product_id);

ALTER TABLE public.domestic_invoice_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "domestic_invoice_items_all" ON public.domestic_invoice_items;
CREATE POLICY "domestic_invoice_items_all" ON public.domestic_invoice_items FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.domestic_invoice_items TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_domestic_invoice_item_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_domestic_invoice_item ON public.domestic_invoice_items;
CREATE TRIGGER trg_touch_domestic_invoice_item
  BEFORE UPDATE ON public.domestic_invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_domestic_invoice_item_updated_at();

-- ============================================================
-- Backfill: for every existing invoice that has 0 items, snapshot
-- its dispatch's items now so the invoice is immediately editable.
-- ============================================================
INSERT INTO public.domestic_invoice_items
  (invoice_id, dispatch_item_id, product_id, description, grade_name, packing_type,
   quantity_dozens, price_per_dozen, amount, line_order)
SELECT
  i.id                                                  AS invoice_id,
  di.id                                                 AS dispatch_item_id,
  p.id                                                  AS product_id,
  COALESCE(p.code, '') || ' — ' || COALESCE(p.name, '') AS description,
  g.name                                                AS grade_name,
  di.packing_type                                       AS packing_type,
  di.quantity_dozens                                    AS quantity_dozens,
  COALESCE(soi.price_per_dozen, 0)                      AS price_per_dozen,
  (di.quantity_dozens * COALESCE(soi.price_per_dozen, 0)) AS amount,
  ROW_NUMBER() OVER (PARTITION BY i.id ORDER BY di.id)  AS line_order
FROM public.domestic_invoices i
JOIN public.sales_dispatch_items di      ON di.dispatch_id = i.dispatch_id
LEFT JOIN public.sales_order_items soi   ON soi.id = di.order_item_id
LEFT JOIN public.products p              ON p.id = soi.product_id
LEFT JOIN public.grades g                ON g.id = soi.grade_id
WHERE i.dispatch_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.domestic_invoice_items ii WHERE ii.invoice_id = i.id
  );
