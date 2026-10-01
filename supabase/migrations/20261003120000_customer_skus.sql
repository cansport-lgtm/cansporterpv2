-- ============================================================================
-- Customer SKUs in the Products master
-- ----------------------------------------------------------------------------
-- The products master held one kind of SKU: ours. Private-label customers have
-- their own brand and packaging, so their items are real, physically distinct
-- products that must still roll up to the planning item / cost of the base
-- product we actually make.
--
-- This migration keeps ONE products table (every sales, dispatch, COGS,
-- inventory and gate-pass table already references products.id) and adds an
-- ownership layer to it:
--
--   owner_type       'own' (company SKU, sellable to any customer) or
--                    'customer' (belongs to exactly one customer; sold only
--                    to that customer).
--   customer_id      required for customer SKUs, must be NULL for own SKUs.
--   base_product_id  optional own SKU this customer SKU is made from.
--
-- Rules enforced here:
--   1. Customer SKU codes are auto-generated as <customer.code>-<NNN> when the
--      code is left blank on insert.
--   2. base_product_id must point at an own SKU (never another customer SKU,
--      never itself). An own SKU that is the base of others cannot be turned
--      into a customer SKU.
--   3. On write, a customer SKU inherits grade, UOM, standard output,
--      planning item, standard cost and standard selling price from its base
--      product for every field left NULL. Values entered explicitly win.
--      Inheritance is write-time (copied, not live) so every existing report
--      that reads products.planning_item_id / standard_cost keeps working.
--
-- products.code stays globally UNIQUE: generated customer codes carry the
-- customer's (unique) code as a prefix, so they can never collide with own
-- SKU codes or another customer's codes.
-- ============================================================================

-- 1. Columns -----------------------------------------------------------------
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'own',
  ADD COLUMN IF NOT EXISTS customer_id UUID
    REFERENCES public.customers(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS base_product_id UUID
    REFERENCES public.products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.products.owner_type IS
  'own = company SKU sellable to any customer; customer = private-label SKU owned by customer_id and sellable only to that customer.';
COMMENT ON COLUMN public.products.customer_id IS
  'Owning customer. Required when owner_type = customer, NULL when owner_type = own.';
COMMENT ON COLUMN public.products.base_product_id IS
  'Own SKU this customer SKU is produced from. Supplies default grade / UOM / output / planning item / costs when those are left blank.';

-- 2. Constraints -------------------------------------------------------------
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_owner_type_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_owner_type_check
  CHECK (owner_type IN ('own', 'customer'));

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_owner_customer_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_owner_customer_check
  CHECK (
    (owner_type = 'own'      AND customer_id IS NULL AND base_product_id IS NULL)
    OR
    (owner_type = 'customer' AND customer_id IS NOT NULL)
  );

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_base_not_self_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_base_not_self_check
  CHECK (base_product_id IS NULL OR base_product_id <> id);

CREATE INDEX IF NOT EXISTS idx_products_customer
  ON public.products(customer_id)
  WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_base_product
  ON public.products(base_product_id)
  WHERE base_product_id IS NOT NULL;

-- 3. Code generation + base-product rules + inheritance ----------------------
CREATE OR REPLACE FUNCTION public.products_customer_sku_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base       public.products%ROWTYPE;
  v_cust_code  TEXT;
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

  IF NEW.customer_id IS NULL THEN
    RAISE EXCEPTION 'A customer SKU must belong to a customer (customer_id is required)';
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

  -- Auto-generate the code as <customer code>-<NNN> when left blank on insert.
  IF TG_OP = 'INSERT' AND COALESCE(btrim(NEW.code), '') = '' THEN
    SELECT NULLIF(btrim(code), '') INTO v_cust_code FROM public.customers WHERE id = NEW.customer_id;
    IF v_cust_code IS NULL THEN
      RAISE EXCEPTION 'Customer % not found for customer SKU', NEW.customer_id;
    END IF;

    -- Serialise generation per customer so two concurrent inserts never
    -- compute the same sequence number.
    PERFORM pg_advisory_xact_lock(hashtext('products_customer_sku:' || NEW.customer_id::text));

    SELECT COUNT(*) INTO v_seq FROM public.products WHERE customer_id = NEW.customer_id;
    LOOP
      v_seq := v_seq + 1;
      v_candidate := v_cust_code || '-' || lpad(v_seq::text, 3, '0');
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

-- 4. Helper: next code preview for the UI -----------------------------------
-- Returns the code the trigger would assign right now (advisory only; the
-- trigger recomputes at insert time).
CREATE OR REPLACE FUNCTION public.next_customer_sku_code(p_customer_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT btrim(c.code) || '-' ||
         lpad(((SELECT COUNT(*) FROM public.products p WHERE p.customer_id = c.id) + 1)::text, 3, '0')
    FROM public.customers c
   WHERE c.id = p_customer_id;
$$;
