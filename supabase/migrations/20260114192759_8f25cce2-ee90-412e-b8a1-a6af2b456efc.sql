-- Create sequences for auto-numbering
CREATE SEQUENCE IF NOT EXISTS purchase_order_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS grn_number_seq START 1;

-- Purchase Orders table
CREATE TABLE public.purchase_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number VARCHAR(50) NOT NULL UNIQUE,
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
    category public.purchase_category NOT NULL,
    order_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date DATE,
    total_amount NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    payment_terms INTEGER,
    shipping_address TEXT,
    notes TEXT,
    created_by UUID REFERENCES public.app_users(id),
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Purchase Order Items
CREATE TABLE public.purchase_order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
    item_id UUID REFERENCES public.items(id),
    description TEXT,
    quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    quantity_received NUMERIC(12,2) DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Goods Receipt Notes (GRN) table
CREATE TABLE public.goods_receipt_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_number VARCHAR(50) NOT NULL UNIQUE,
    purchase_order_id UUID NOT NULL REFERENCES public.purchase_orders(id),
    supplier_id UUID NOT NULL REFERENCES public.suppliers(id),
    receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
    invoice_number VARCHAR(100),
    invoice_date DATE,
    invoice_amount NUMERIC(12,2),
    total_amount NUMERIC(12,2) DEFAULT 0,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    notes TEXT,
    received_by UUID REFERENCES public.app_users(id),
    approved_by UUID REFERENCES public.app_users(id),
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- GRN Items
CREATE TABLE public.grn_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grn_id UUID NOT NULL REFERENCES public.goods_receipt_notes(id) ON DELETE CASCADE,
    po_item_id UUID REFERENCES public.purchase_order_items(id),
    item_id UUID REFERENCES public.items(id),
    description TEXT,
    quantity_ordered NUMERIC(12,2) DEFAULT 0,
    quantity_received NUMERIC(12,2) NOT NULL DEFAULT 0,
    unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipt_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grn_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for purchase_orders (allow all authenticated for now, category-based access handled in app)
CREATE POLICY "Allow all operations on purchase_orders" ON public.purchase_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on purchase_order_items" ON public.purchase_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on goods_receipt_notes" ON public.goods_receipt_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on grn_items" ON public.grn_items FOR ALL USING (true) WITH CHECK (true);

-- Auto-generate PO number
CREATE OR REPLACE FUNCTION public.generate_po_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.po_number := 'PO-' || LPAD(NEXTVAL('purchase_order_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_generate_po_number
  BEFORE INSERT ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_po_number();

-- Auto-generate GRN number
CREATE OR REPLACE FUNCTION public.generate_grn_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.grn_number := 'GRN-' || LPAD(NEXTVAL('grn_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_generate_grn_number
  BEFORE INSERT ON public.goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_grn_number();

-- Update received quantity on PO items when GRN is created
CREATE OR REPLACE FUNCTION public.update_po_item_received_qty()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.purchase_order_items
    SET quantity_received = quantity_received + NEW.quantity_received
    WHERE id = NEW.po_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.purchase_order_items
    SET quantity_received = quantity_received - OLD.quantity_received
    WHERE id = OLD.po_item_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.purchase_order_items
    SET quantity_received = quantity_received - OLD.quantity_received + NEW.quantity_received
    WHERE id = NEW.po_item_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trigger_update_po_item_received
  AFTER INSERT OR UPDATE OR DELETE ON public.grn_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_po_item_received_qty();

-- Updated_at triggers
CREATE TRIGGER update_purchase_orders_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_purchase_order_items_updated_at
  BEFORE UPDATE ON public.purchase_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_grn_updated_at
  BEFORE UPDATE ON public.goods_receipt_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();