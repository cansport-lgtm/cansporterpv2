-- Distributor Order Management module — Phase 2 (catalog, pricing & orders).
-- Builds on Phase 1. Adds:
--   1. distributor_products       — each distributor's OWN product list, each optionally
--                                   mapped to a company SKU (public.products) and carrying a
--                                   distributor-set selling price.
--   2. distributor_orders         — order header with the approval workflow
--                                   (draft → submitted → approved/rejected → dispatched/…).
--   3. distributor_order_items    — order lines; snapshot the product name + mapped company
--                                   SKU at order time so later reporting is stable.
-- plus auto-numbering (DO-YY-NNNN), updated_at triggers, anon-auth RLS and indexes.
-- All per-distributor isolation is enforced in the app layer (filter on distributor_id).

-- =====================================================================
-- 1. distributor_products  (a distributor's own catalog)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.distributor_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id uuid NOT NULL,
  code text,
  name text NOT NULL,
  -- Mapping back to the company catalog so bulk-dispatch requirements aggregate by real SKU.
  company_product_id uuid,
  price numeric NOT NULL DEFAULT 0,
  unit text,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributor_products_distributor_id_fkey
    FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE CASCADE,
  CONSTRAINT distributor_products_company_product_id_fkey
    FOREIGN KEY (company_product_id) REFERENCES public.products(id) ON DELETE SET NULL,
  CONSTRAINT distributor_products_dist_code_key UNIQUE (distributor_id, code)
);

CREATE INDEX IF NOT EXISTS idx_distributor_products_distributor_id
  ON public.distributor_products (distributor_id);
CREATE INDEX IF NOT EXISTS idx_distributor_products_company_product_id
  ON public.distributor_products (company_product_id);

-- =====================================================================
-- 2. distributor_orders  (header)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.distributor_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text,
  distributor_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  order_date date NOT NULL DEFAULT CURRENT_DATE,
  required_date date,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','approved','rejected','dispatched','delivered','cancelled')),
  total_amount numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributor_orders_order_number_key UNIQUE (order_number),
  CONSTRAINT distributor_orders_distributor_id_fkey
    FOREIGN KEY (distributor_id) REFERENCES public.distributors(id) ON DELETE CASCADE,
  CONSTRAINT distributor_orders_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.distributor_customers(id) ON DELETE CASCADE,
  CONSTRAINT distributor_orders_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT distributor_orders_approved_by_fkey
    FOREIGN KEY (approved_by) REFERENCES public.app_users(id) ON DELETE SET NULL,
  CONSTRAINT distributor_orders_rejected_by_fkey
    FOREIGN KEY (rejected_by) REFERENCES public.app_users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_distributor_orders_distributor_id
  ON public.distributor_orders (distributor_id);
CREATE INDEX IF NOT EXISTS idx_distributor_orders_status
  ON public.distributor_orders (distributor_id, status);
CREATE INDEX IF NOT EXISTS idx_distributor_orders_customer_id
  ON public.distributor_orders (customer_id);

-- =====================================================================
-- 3. distributor_order_items  (lines)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.distributor_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  distributor_product_id uuid,
  -- Snapshots so the line stays meaningful even if the catalog later changes.
  company_product_id uuid,
  product_name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit text,
  price numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  quantity_dispatched numeric NOT NULL DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT distributor_order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.distributor_orders(id) ON DELETE CASCADE,
  CONSTRAINT distributor_order_items_distributor_product_id_fkey
    FOREIGN KEY (distributor_product_id) REFERENCES public.distributor_products(id) ON DELETE SET NULL,
  CONSTRAINT distributor_order_items_company_product_id_fkey
    FOREIGN KEY (company_product_id) REFERENCES public.products(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_distributor_order_items_order_id
  ON public.distributor_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_distributor_order_items_company_product_id
  ON public.distributor_order_items (company_product_id);

-- =====================================================================
-- 4. Auto-number: DO-YY-NNNN (pages insert order_number = '' / NULL)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.generate_distributor_order_number()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE v_year TEXT; v_max INT;
BEGIN
  IF NEW.order_number IS NOT NULL AND NEW.order_number <> '' THEN RETURN NEW; END IF;
  v_year := TO_CHAR(CURRENT_DATE, 'YY');
  SELECT COALESCE(MAX(NULLIF(SUBSTRING(order_number FROM 7), '')::INTEGER), 0) + 1
    INTO v_max
    FROM public.distributor_orders
    WHERE order_number LIKE 'DO-' || v_year || '-%';
  NEW.order_number := 'DO-' || v_year || '-' || LPAD(v_max::TEXT, 4, '0');
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_generate_distributor_order_number ON public.distributor_orders;
CREATE TRIGGER trg_generate_distributor_order_number
  BEFORE INSERT ON public.distributor_orders
  FOR EACH ROW EXECUTE FUNCTION public.generate_distributor_order_number();

-- =====================================================================
-- 5. updated_at triggers
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['distributor_products','distributor_orders','distributor_order_items'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_updated_at ON public.%I;', t, t);
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();', t, t);
  END LOOP;
END $$;

-- =====================================================================
-- 6. RLS: anon-auth model (Allow all TO public)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['distributor_products','distributor_orders','distributor_order_items'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "Allow all for %s" ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY "Allow all for %s" ON public.%I FOR ALL TO public USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
