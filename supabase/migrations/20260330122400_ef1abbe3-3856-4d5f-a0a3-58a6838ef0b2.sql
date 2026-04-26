
-- Online Sales B2C Module tables

-- Online Orders
CREATE TABLE public.online_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'other',
  platform_order_id TEXT,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  customer_email TEXT,
  shipping_address TEXT,
  city TEXT,
  state TEXT,
  pincode TEXT,
  payment_mode TEXT DEFAULT 'prepaid',
  order_value NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES public.app_users(id),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Online Dispatches
CREATE TABLE public.online_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_number TEXT NOT NULL,
  order_id UUID REFERENCES public.online_orders(id) ON DELETE CASCADE NOT NULL,
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  courier_partner TEXT,
  awb_number TEXT,
  weight_grams NUMERIC,
  status TEXT DEFAULT 'packed',
  dispatched_by UUID REFERENCES public.app_users(id),
  delivered_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Online Returns
CREATE TABLE public.online_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_number TEXT NOT NULL,
  order_id UUID REFERENCES public.online_orders(id) ON DELETE CASCADE NOT NULL,
  dispatch_id UUID REFERENCES public.online_dispatches(id),
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  return_reason TEXT,
  refund_status TEXT DEFAULT 'pending',
  refund_amount NUMERIC DEFAULT 0,
  received_back BOOLEAN DEFAULT false,
  received_date DATE,
  remarks TEXT,
  created_by UUID REFERENCES public.app_users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Online Load Sheets (date-wise dispatch list)
CREATE TABLE public.online_load_sheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_number TEXT NOT NULL,
  sheet_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_parcels INTEGER DEFAULT 0,
  total_weight_grams NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'draft',
  prepared_by UUID REFERENCES public.app_users(id),
  remarks TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Link dispatches to load sheets
ALTER TABLE public.online_dispatches ADD COLUMN load_sheet_id UUID REFERENCES public.online_load_sheets(id);

-- Sequences for auto-numbering
CREATE SEQUENCE IF NOT EXISTS online_order_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS online_dispatch_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS online_return_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS online_load_sheet_number_seq START 1;

-- Auto-generate order number
CREATE OR REPLACE FUNCTION public.generate_online_order_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.order_number := 'ONL-' || LPAD(NEXTVAL('online_order_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_online_order_number
  BEFORE INSERT ON public.online_orders
  FOR EACH ROW WHEN (NEW.order_number IS NULL OR NEW.order_number = '')
  EXECUTE FUNCTION public.generate_online_order_number();

-- Auto-generate dispatch number
CREATE OR REPLACE FUNCTION public.generate_online_dispatch_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.dispatch_number := 'OD-' || LPAD(NEXTVAL('online_dispatch_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_online_dispatch_number
  BEFORE INSERT ON public.online_dispatches
  FOR EACH ROW WHEN (NEW.dispatch_number IS NULL OR NEW.dispatch_number = '')
  EXECUTE FUNCTION public.generate_online_dispatch_number();

-- Auto-generate return number
CREATE OR REPLACE FUNCTION public.generate_online_return_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.return_number := 'RET-' || LPAD(NEXTVAL('online_return_number_seq')::TEXT, 5, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_online_return_number
  BEFORE INSERT ON public.online_returns
  FOR EACH ROW WHEN (NEW.return_number IS NULL OR NEW.return_number = '')
  EXECUTE FUNCTION public.generate_online_return_number();

-- Auto-generate load sheet number
CREATE OR REPLACE FUNCTION public.generate_online_load_sheet_number()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.sheet_number := 'LS-' || TO_CHAR(NEW.sheet_date, 'YYYYMMDD') || '-' || LPAD(NEXTVAL('online_load_sheet_number_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_online_load_sheet_number
  BEFORE INSERT ON public.online_load_sheets
  FOR EACH ROW WHEN (NEW.sheet_number IS NULL OR NEW.sheet_number = '')
  EXECUTE FUNCTION public.generate_online_load_sheet_number();

-- RLS policies
ALTER TABLE public.online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.online_load_sheets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view online orders" ON public.online_orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert online orders" ON public.online_orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update online orders" ON public.online_orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete online orders" ON public.online_orders FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view online dispatches" ON public.online_dispatches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert online dispatches" ON public.online_dispatches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update online dispatches" ON public.online_dispatches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete online dispatches" ON public.online_dispatches FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view online returns" ON public.online_returns FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert online returns" ON public.online_returns FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update online returns" ON public.online_returns FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete online returns" ON public.online_returns FOR DELETE TO authenticated USING (true);

CREATE POLICY "Authenticated users can view online load sheets" ON public.online_load_sheets FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert online load sheets" ON public.online_load_sheets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update online load sheets" ON public.online_load_sheets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can delete online load sheets" ON public.online_load_sheets FOR DELETE TO authenticated USING (true);
