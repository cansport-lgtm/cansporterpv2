
-- 1. Sample items master
CREATE TABLE public.crm_sample_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.crm_products(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.crm_product_variants(id) ON DELETE SET NULL,
  sku text,
  unit text NOT NULL DEFAULT 'pcs',
  reorder_level numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_sample_items_product ON public.crm_sample_items(product_id);
ALTER TABLE public.crm_sample_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all crm_sample_items" ON public.crm_sample_items TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all crm_sample_items" ON public.crm_sample_items TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_crm_sample_items_updated BEFORE UPDATE ON public.crm_sample_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Sample requests header
CREATE TABLE public.crm_sample_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number text UNIQUE,
  request_date date NOT NULL DEFAULT CURRENT_DATE,
  requested_by text,
  requested_by_user_id uuid,
  recipient_type text NOT NULL CHECK (recipient_type IN ('lead','contact','customer')),
  lead_id uuid REFERENCES public.crm_leads(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.crm_contacts(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  recipient_name text,
  recipient_company text,
  recipient_phone text,
  recipient_address text,
  recipient_city text,
  recipient_area text,
  purpose text,
  notes text,
  status text NOT NULL DEFAULT 'Requested'
    CHECK (status IN ('Requested','Approved','Rejected','Issued','Delivered','Cancelled')),
  approved_by text,
  approved_at timestamptz,
  rejection_reason text,
  issued_by text,
  issued_at timestamptz,
  courier_name text,
  tracking_number text,
  expected_delivery_date date,
  delivered_at timestamptz,
  delivery_remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_sample_requests_status ON public.crm_sample_requests(status);
CREATE INDEX idx_crm_sample_requests_date ON public.crm_sample_requests(request_date);
ALTER TABLE public.crm_sample_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all crm_sample_requests" ON public.crm_sample_requests TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all crm_sample_requests" ON public.crm_sample_requests TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_crm_sample_requests_updated BEFORE UPDATE ON public.crm_sample_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Request items
CREATE TABLE public.crm_sample_request_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.crm_sample_requests(id) ON DELETE CASCADE,
  sample_item_id uuid NOT NULL REFERENCES public.crm_sample_items(id) ON DELETE RESTRICT,
  quantity numeric(12,2) NOT NULL DEFAULT 1,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_sample_request_items_req ON public.crm_sample_request_items(request_id);
ALTER TABLE public.crm_sample_request_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all crm_sample_request_items" ON public.crm_sample_request_items TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all crm_sample_request_items" ON public.crm_sample_request_items TO authenticated USING (true) WITH CHECK (true);

-- 4. Sample stock movements ledger
CREATE TABLE public.crm_sample_stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_item_id uuid NOT NULL REFERENCES public.crm_sample_items(id) ON DELETE CASCADE,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  movement_type text NOT NULL CHECK (movement_type IN ('opening','receipt','issue','return','adjustment')),
  quantity numeric(12,2) NOT NULL,
  reference_type text,
  reference_id uuid,
  remarks text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_crm_sample_movements_item ON public.crm_sample_stock_movements(sample_item_id);
CREATE INDEX idx_crm_sample_movements_ref ON public.crm_sample_stock_movements(reference_type, reference_id);
ALTER TABLE public.crm_sample_stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon all crm_sample_stock_movements" ON public.crm_sample_stock_movements TO anon USING (true) WITH CHECK (true);
CREATE POLICY "auth all crm_sample_stock_movements" ON public.crm_sample_stock_movements TO authenticated USING (true) WITH CHECK (true);

-- 5. Request number trigger SR-YY-XXXX
CREATE OR REPLACE FUNCTION public.generate_crm_sample_request_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_year TEXT;
  v_max INTEGER;
BEGIN
  IF NEW.request_number IS NOT NULL AND NEW.request_number <> '' THEN
    RETURN NEW;
  END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(
    CASE WHEN request_number LIKE 'SR-' || v_year || '-%'
         THEN NULLIF(SUBSTRING(request_number FROM 7), '')::INTEGER
         ELSE 0 END
  ), 0) + 1 INTO v_max
  FROM public.crm_sample_requests
  WHERE request_number LIKE 'SR-' || v_year || '-%';
  NEW.request_number := 'SR-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_crm_sample_requests_number BEFORE INSERT ON public.crm_sample_requests
  FOR EACH ROW EXECUTE FUNCTION public.generate_crm_sample_request_number();

-- 6. Status -> stock automation
CREATE OR REPLACE FUNCTION public.crm_sample_request_apply_stock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  r RECORD;
BEGIN
  -- On transition to Issued: create negative issue movements (idempotent)
  IF NEW.status = 'Issued' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'Issued') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.crm_sample_stock_movements
      WHERE reference_type = 'request' AND reference_id = NEW.id AND movement_type = 'issue'
    ) THEN
      FOR r IN
        SELECT sample_item_id, quantity FROM public.crm_sample_request_items WHERE request_id = NEW.id
      LOOP
        INSERT INTO public.crm_sample_stock_movements (
          sample_item_id, movement_date, movement_type, quantity,
          reference_type, reference_id, remarks, created_by
        ) VALUES (
          r.sample_item_id, COALESCE(NEW.issued_at::date, CURRENT_DATE), 'issue',
          -ABS(r.quantity), 'request', NEW.id,
          'Issued via ' || COALESCE(NEW.request_number, 'request'), NEW.issued_by
        );
      END LOOP;
    END IF;
  END IF;

  -- If status moves AWAY from Issued/Delivered to Cancelled/Rejected, reverse with return
  IF TG_OP = 'UPDATE'
     AND OLD.status IN ('Issued','Delivered')
     AND NEW.status IN ('Cancelled','Rejected') THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.crm_sample_stock_movements
      WHERE reference_type = 'request' AND reference_id = NEW.id AND movement_type = 'return'
    ) THEN
      FOR r IN
        SELECT sample_item_id, quantity FROM public.crm_sample_request_items WHERE request_id = NEW.id
      LOOP
        INSERT INTO public.crm_sample_stock_movements (
          sample_item_id, movement_date, movement_type, quantity,
          reference_type, reference_id, remarks, created_by
        ) VALUES (
          r.sample_item_id, CURRENT_DATE, 'return',
          ABS(r.quantity), 'request', NEW.id,
          'Reversal for ' || COALESCE(NEW.request_number, 'request'), NEW.issued_by
        );
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_crm_sample_requests_stock AFTER INSERT OR UPDATE OF status ON public.crm_sample_requests
  FOR EACH ROW EXECUTE FUNCTION public.crm_sample_request_apply_stock();
