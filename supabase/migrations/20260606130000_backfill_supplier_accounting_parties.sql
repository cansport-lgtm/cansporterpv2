-- Backfill accounting parties for existing suppliers.
--
-- Suppliers created via the Suppliers page were inserted into `suppliers` only,
-- without a linked `accounting_parties` row. The Accounts Payable / Supplier
-- Payments list is driven by `accounting_parties` (party_type = 'supplier'), so
-- those vendors (e.g. "MS oil trader") never showed up there.
--
-- Create a matching accounting party for every supplier that isn't linked yet
-- and wire up the bridge column. Idempotent: only touches NULL links.

DO $$
DECLARE
  r RECORD;
  new_party_id UUID;
BEGIN
  FOR r IN
    SELECT id, name, code, is_active
    FROM public.suppliers
    WHERE accounting_party_id IS NULL
  LOOP
    -- code is left NULL to match the existing party convention and avoid the
    -- UNIQUE (code) constraint on accounting_parties.
    INSERT INTO public.accounting_parties (name, code, party_type, is_active)
    VALUES (r.name, NULL, 'supplier', COALESCE(r.is_active, true))
    RETURNING id INTO new_party_id;

    UPDATE public.suppliers
    SET accounting_party_id = new_party_id
    WHERE id = r.id;
  END LOOP;
END $$;
