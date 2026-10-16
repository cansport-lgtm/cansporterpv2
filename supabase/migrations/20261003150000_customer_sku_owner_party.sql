-- ============================================================================
-- Customer SKUs are owned by the accounts-receivable party, not a ship-to row
-- ----------------------------------------------------------------------------
-- 20261003120000_customer_skus.sql linked a customer SKU to a row of the
-- sales `customers` master. That master mixes billing customers with their
-- ship-to shops (one receivables party can have 20+ customer rows), and most
-- rows are not accounting customers at all. The owner of a private-label SKU
-- is the receivables customer: the accounting party of type 'customer'.
--
-- This migration is ADDITIVE so the already-deployed front end keeps working
-- until the new build is live:
--   * adds products.customer_party_id → accounting_parties(id)
--   * moves the "customer SKU needs an owner" rule onto that column
--   * generates codes from the party: <party code>-NNN, or, when the party
--     has no code, the first 8 letters/digits of its name in upper case
--   * next_customer_sku_code(p_party_id) previews the code for the UI
-- The old products.customer_id column is dropped by the follow-up migration
-- 20261003160000_customer_sku_drop_customer_id.sql once the UI no longer
-- reads it.
-- ============================================================================

-- 1. New owner column ---------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS customer_party_id UUID
    REFERENCES public.accounting_parties(id) ON DELETE RESTRICT;

COMMENT ON COLUMN public.products.customer_party_id IS
  'Accounts-receivable party (accounting_parties, party_type = customer) that owns this private-label SKU. Required when owner_type = customer, NULL when owner_type = own.';

CREATE INDEX IF NOT EXISTS idx_products_customer_party
  ON public.products(customer_party_id)
  WHERE customer_party_id IS NOT NULL;

-- Carry over any SKU already linked to a sales customer that has a party.
-- Guarded so this migration stays re-runnable after customer_id is dropped.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'products'
                AND column_name = 'customer_id') THEN
    UPDATE public.products p
       SET customer_party_id = c.accounting_party_id
      FROM public.customers c
     WHERE p.customer_id = c.id
       AND p.customer_party_id IS NULL
       AND c.accounting_party_id IS NOT NULL;
  END IF;
END $$;

-- 2. Ownership rule now keyed on the party ------------------------------------
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_owner_customer_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_owner_customer_check
  CHECK (
    (owner_type = 'own'      AND customer_party_id IS NULL AND base_product_id IS NULL)
    OR
    (owner_type = 'customer' AND customer_party_id IS NOT NULL)
  );

-- 3. Trigger: party validation, inheritance, code generation ------------------
CREATE OR REPLACE FUNCTION public.products_customer_sku_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base       public.products%ROWTYPE;
  v_prefix     TEXT;
  v_ptype      TEXT;
  v_seq        INTEGER;
  v_candidate  TEXT;
BEGIN
  -- An own SKU that other SKUs are based on cannot become a customer SKU.
  IF TG_OP = 'UPDATE'
     AND NEW.owner_type = 'customer'
     AND OLD.owner_type = 'own'
     AND EXISTS (SELECT 1 FROM public.products WHERE base_product_id = NEW.id) THEN
    RAISE EXCEPTION 'Product % is the base of other customer SKUs and cannot be changed to a customer SKU', OLD.code;
  END IF;

  IF NEW.owner_type = 'own' THEN
    RETURN NEW;
  END IF;

  -- ---- customer SKU from here on ----------------------------------------

  IF NEW.customer_party_id IS NULL THEN
    RAISE EXCEPTION 'A customer SKU must belong to an accounts-receivable customer (customer_party_id is required)';
  END IF;

  -- Owner must be a receivables (customer) party.
  SELECT party_type::text,
         COALESCE(NULLIF(btrim(code), ''),
                  upper(left(regexp_replace(name, '[^A-Za-z0-9]', '', 'g'), 8)))
    INTO v_ptype, v_prefix
    FROM public.accounting_parties
   WHERE id = NEW.customer_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Accounting party % not found for customer SKU', NEW.customer_party_id;
  END IF;
  IF v_ptype <> 'customer' THEN
    RAISE EXCEPTION 'Customer SKU owner must be a receivables (customer) party, not a % party', v_ptype;
  END IF;
  IF COALESCE(v_prefix, '') = '' THEN
    RAISE EXCEPTION 'Accounting party % has neither a code nor a usable name for the SKU prefix', NEW.customer_party_id;
  END IF;

  -- Base product must be one of our own SKUs.
  IF NEW.base_product_id IS NOT NULL THEN
    SELECT * INTO v_base FROM public.products WHERE id = NEW.base_product_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Base product % does not exist', NEW.base_product_id;
    END IF;
    IF v_base.owner_type <> 'own' THEN
      RAISE EXCEPTION 'Base product must be an own (company) SKU, % is a customer SKU', v_base.code;
    END IF;

    -- Inherit defaults for anything left blank.
    NEW.grade_id               := COALESCE(NEW.grade_id,               v_base.grade_id);
    NEW.uom_id                 := COALESCE(NEW.uom_id,                 v_base.uom_id);
    NEW.standard_output_rate   := COALESCE(NEW.standard_output_rate,   v_base.standard_output_rate);
    NEW.planning_item_id       := COALESCE(NEW.planning_item_id,       v_base.planning_item_id);
    NEW.standard_cost          := COALESCE(NEW.standard_cost,          v_base.standard_cost);
    IF COALESCE(NEW.standard_selling_price, 0) = 0 THEN
      NEW.standard_selling_price := v_base.standard_selling_price;
    END IF;
  END IF;

  -- Auto-generate the code as <party prefix>-<NNN> when left blank on insert.
  IF TG_OP = 'INSERT' AND COALESCE(btrim(NEW.code), '') = '' THEN
    -- Serialise generation per party so two concurrent inserts never
    -- compute the same sequence number.
    PERFORM pg_advisory_xact_lock(hashtext('products_customer_sku:' || NEW.customer_party_id::text));

    SELECT COUNT(*) INTO v_seq FROM public.products WHERE customer_party_id = NEW.customer_party_id;
    LOOP
      v_seq := v_seq + 1;
      v_candidate := v_prefix || '-' || lpad(v_seq::text, 3, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.products WHERE code = v_candidate);
    END LOOP;
    NEW.code := v_candidate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_customer_sku_before_write ON public.products;
CREATE TRIGGER trg_products_customer_sku_before_write
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.products_customer_sku_before_write();

-- 4. Helper: next code preview for the UI (now keyed by party) ---------------
DROP FUNCTION IF EXISTS public.next_customer_sku_code(UUID);

CREATE OR REPLACE FUNCTION public.next_customer_sku_code(p_party_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(ap.code), ''),
                  upper(left(regexp_replace(ap.name, '[^A-Za-z0-9]', '', 'g'), 8)))
         || '-' ||
         lpad(((SELECT COUNT(*) FROM public.products p WHERE p.customer_party_id = ap.id) + 1)::text, 3, '0')
    FROM public.accounting_parties ap
   WHERE ap.id = p_party_id;
$$;

-- 5. Old column is kept (nullable, unused) until the UI stops selecting it ---
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'products'
                AND column_name = 'customer_id') THEN
    COMMENT ON COLUMN public.products.customer_id IS
      'DEPRECATED: replaced by customer_party_id. Dropped by 20261003160000_customer_sku_drop_customer_id.sql.';
  END IF;
END $$;
