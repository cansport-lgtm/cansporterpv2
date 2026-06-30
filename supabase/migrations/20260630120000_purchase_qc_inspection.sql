-- ============================================================================
-- Purchase Quality Inspection (incoming material QC gate)
-- ----------------------------------------------------------------------------
-- Adds a quality-inspection step to the purchase process for RAW MATERIAL.
-- Flow:  PO approved  ->  QC inspection created & approved  ->  Goods Receipt.
--
--   * Raw-material POs carry qc_status = 'pending' until an inspection is
--     approved, at which point it becomes 'passed' (some qty accepted) or
--     'failed' (everything rejected).
--   * Non raw-material POs are 'not_required' and skip the gate entirely.
--   * A Goods Receipt cannot be created for a raw-material PO until its
--     qc_status is 'passed' (enforced both in the UI and by a DB trigger).
-- ============================================================================

-- 1. QC status on purchase orders ------------------------------------------------
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS qc_status VARCHAR(50) NOT NULL DEFAULT 'not_required';

COMMENT ON COLUMN public.purchase_orders.qc_status IS
  'Incoming-material QC gate: not_required | pending | passed | failed. Raw material starts pending; GRN allowed only once passed.';

-- Grandfather existing raw-material POs as already-passed so in-flight orders
-- remain receivable. Only orders created after this migration are gated.
UPDATE public.purchase_orders
   SET qc_status = 'passed'
 WHERE category = 'raw_material';

-- New raw-material POs start their life pending QC; everything else is exempt.
CREATE OR REPLACE FUNCTION public.set_po_initial_qc_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.category = 'raw_material' THEN
    NEW.qc_status := 'pending';
  ELSE
    NEW.qc_status := 'not_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_po_initial_qc_status ON public.purchase_orders;
CREATE TRIGGER trg_po_initial_qc_status
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_po_initial_qc_status();

-- 2. Inspection tables -----------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS purchase_qc_number_seq START 1;

CREATE TABLE IF NOT EXISTS public.purchase_qc_inspections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_number VARCHAR(50) NOT NULL UNIQUE,
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
    inspection_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
    result VARCHAR(50),                               -- pass | partial | fail (set on approval)
    inspected_by UUID REFERENCES public.app_users(id),
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.purchase_qc_inspection_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    inspection_id UUID NOT NULL REFERENCES public.purchase_qc_inspections(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES public.purchase_order_items(id),
    item_id UUID REFERENCES public.items(id),
    description TEXT,
    quantity_ordered NUMERIC(12,2) DEFAULT 0,
    quantity_inspected NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_accepted NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_rejected NUMERIC(12,2) NOT NULL DEFAULT 0,
    result VARCHAR(50) NOT NULL DEFAULT 'pass',       -- pass | fail
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_purchase_qc_inspections_po
  ON public.purchase_qc_inspections(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_qc_inspection_items_inspection
  ON public.purchase_qc_inspection_items(inspection_id);

-- RLS — allow-all for authenticated, mirroring the rest of the purchase module
-- (category-based access is enforced in the application layer).
ALTER TABLE public.purchase_qc_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_qc_inspection_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on purchase_qc_inspections"
  ON public.purchase_qc_inspections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on purchase_qc_inspection_items"
  ON public.purchase_qc_inspection_items FOR ALL USING (true) WITH CHECK (true);

-- Auto-generate inspection number (QC-00001, QC-00002, ...).
CREATE OR REPLACE FUNCTION public.generate_purchase_qc_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.qc_number := 'QC-' || LPAD(NEXTVAL('purchase_qc_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_purchase_qc_number ON public.purchase_qc_inspections;
CREATE TRIGGER trg_generate_purchase_qc_number
  BEFORE INSERT ON public.purchase_qc_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_purchase_qc_number();

DROP TRIGGER IF EXISTS update_purchase_qc_inspections_updated_at ON public.purchase_qc_inspections;
CREATE TRIGGER update_purchase_qc_inspections_updated_at
  BEFORE UPDATE ON public.purchase_qc_inspections
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Enforce the gate at the database level -------------------------------------
-- A raw-material PO must have passed QC before any goods receipt is recorded.
CREATE OR REPLACE FUNCTION public.enforce_qc_before_grn()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  po_category public.purchase_category;
  po_qc_status VARCHAR(50);
BEGIN
  SELECT category, qc_status
    INTO po_category, po_qc_status
    FROM public.purchase_orders
   WHERE id = NEW.purchase_order_id;

  IF po_category = 'raw_material' AND COALESCE(po_qc_status, '') <> 'passed' THEN
    RAISE EXCEPTION 'Goods receipt blocked: raw material purchase order % must pass quality inspection before goods can be received.', NEW.purchase_order_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_qc_before_grn ON public.goods_receipt_notes;
CREATE TRIGGER trg_enforce_qc_before_grn
  BEFORE INSERT ON public.goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_qc_before_grn();
