-- Sales Module Tables

-- Customer logos storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('customer-logos', 'customer-logos', true);

-- Storage policies for customer logos
CREATE POLICY "Customer logos are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'customer-logos');

CREATE POLICY "Authenticated users can upload customer logos"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'customer-logos' AND auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can update customer logos"
ON storage.objects FOR UPDATE
USING (bucket_id = 'customer-logos');

CREATE POLICY "Authenticated users can delete customer logos"
ON storage.objects FOR DELETE
USING (bucket_id = 'customer-logos');

-- Add logo_url to customers table
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- Customer-specific pricing table
CREATE TABLE public.customer_pricing (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  price_per_dozen DECIMAL(12, 2) NOT NULL,
  min_quantity_dozens INTEGER DEFAULT 1,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(customer_id, product_id, effective_from)
);

-- Sales quotations table
CREATE TABLE public.sales_quotations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  quotation_date DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until DATE,
  total_amount DECIMAL(14, 2) DEFAULT 0,
  discount_percent DECIMAL(5, 2) DEFAULT 0,
  net_amount DECIMAL(14, 2) DEFAULT 0,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted')),
  converted_to_order_id UUID,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Sales quotation items table
CREATE TABLE public.sales_quotation_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_id UUID NOT NULL REFERENCES public.sales_quotations(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  grade_id UUID REFERENCES public.grades(id),
  packing_type TEXT,
  quantity_dozens INTEGER NOT NULL,
  price_per_dozen DECIMAL(12, 2) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Sales orders table
CREATE TABLE public.sales_orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  quotation_id UUID REFERENCES public.sales_quotations(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  required_date DATE,
  total_amount DECIMAL(14, 2) DEFAULT 0,
  discount_percent DECIMAL(5, 2) DEFAULT 0,
  net_amount DECIMAL(14, 2) DEFAULT 0,
  payment_terms TEXT,
  shipping_address TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed', 'in_production', 'ready', 'partially_dispatched', 'dispatched', 'delivered', 'cancelled')),
  created_by UUID REFERENCES public.app_users(id),
  approved_by UUID REFERENCES public.app_users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Sales order items table
CREATE TABLE public.sales_order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id),
  grade_id UUID REFERENCES public.grades(id),
  packing_type TEXT,
  quantity_dozens INTEGER NOT NULL,
  quantity_dispatched INTEGER DEFAULT 0,
  price_per_dozen DECIMAL(12, 2) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Dispatch/Delivery table
CREATE TABLE public.sales_dispatches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dispatch_number TEXT NOT NULL UNIQUE,
  order_id UUID NOT NULL REFERENCES public.sales_orders(id),
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  vehicle_number TEXT,
  driver_name TEXT,
  driver_contact TEXT,
  transporter_name TEXT,
  lr_number TEXT,
  lr_date DATE,
  freight_charges DECIMAL(12, 2) DEFAULT 0,
  total_packages INTEGER DEFAULT 0,
  total_weight DECIMAL(10, 2),
  delivery_address TEXT,
  expected_delivery_date DATE,
  actual_delivery_date DATE,
  delivery_status TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'in_transit', 'delivered', 'returned')),
  receiver_name TEXT,
  receiver_signature TEXT,
  notes TEXT,
  dispatched_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Dispatch items table
CREATE TABLE public.sales_dispatch_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  dispatch_id UUID NOT NULL REFERENCES public.sales_dispatches(id) ON DELETE CASCADE,
  order_item_id UUID NOT NULL REFERENCES public.sales_order_items(id),
  quantity_dozens INTEGER NOT NULL,
  packages INTEGER DEFAULT 1,
  remarks TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.customer_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_dispatch_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow authenticated users full access for now)
CREATE POLICY "Allow all for customer_pricing" ON public.customer_pricing FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_quotations" ON public.sales_quotations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_quotation_items" ON public.sales_quotation_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_orders" ON public.sales_orders FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_order_items" ON public.sales_order_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_dispatches" ON public.sales_dispatches FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for sales_dispatch_items" ON public.sales_dispatch_items FOR ALL USING (true) WITH CHECK (true);

-- Functions for auto-generating numbers
CREATE OR REPLACE FUNCTION public.generate_quotation_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.quotation_number := 'QTN-' || LPAD(NEXTVAL('quotation_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.generate_sales_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number := 'SO-' || LPAD(NEXTVAL('sales_order_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.generate_dispatch_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.dispatch_number := 'DC-' || LPAD(NEXTVAL('dispatch_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create sequences
CREATE SEQUENCE IF NOT EXISTS quotation_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS sales_order_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS dispatch_number_seq START 1;

-- Create triggers
CREATE TRIGGER set_quotation_number
  BEFORE INSERT ON public.sales_quotations
  FOR EACH ROW
  WHEN (NEW.quotation_number IS NULL OR NEW.quotation_number = '')
  EXECUTE FUNCTION public.generate_quotation_number();

CREATE TRIGGER set_sales_order_number
  BEFORE INSERT ON public.sales_orders
  FOR EACH ROW
  WHEN (NEW.order_number IS NULL OR NEW.order_number = '')
  EXECUTE FUNCTION public.generate_sales_order_number();

CREATE TRIGGER set_dispatch_number
  BEFORE INSERT ON public.sales_dispatches
  FOR EACH ROW
  WHEN (NEW.dispatch_number IS NULL OR NEW.dispatch_number = '')
  EXECUTE FUNCTION public.generate_dispatch_number();

-- Update trigger for updated_at columns
CREATE TRIGGER update_customer_pricing_updated_at
  BEFORE UPDATE ON public.customer_pricing
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_quotations_updated_at
  BEFORE UPDATE ON public.sales_quotations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_orders_updated_at
  BEFORE UPDATE ON public.sales_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_order_items_updated_at
  BEFORE UPDATE ON public.sales_order_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_dispatches_updated_at
  BEFORE UPDATE ON public.sales_dispatches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Function to update dispatched quantity on order items
CREATE OR REPLACE FUNCTION public.update_order_item_dispatched_qty()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched + NEW.quantity_dozens
    WHERE id = NEW.order_item_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched - OLD.quantity_dozens
    WHERE id = OLD.order_item_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.sales_order_items
    SET quantity_dispatched = quantity_dispatched - OLD.quantity_dozens + NEW.quantity_dozens
    WHERE id = NEW.order_item_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_dispatched_qty
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_dispatch_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_order_item_dispatched_qty();