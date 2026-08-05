-- Merge duplicate accounting party "Osama Trader" into "Osama Traders".
--
-- A customer's billing_customer was typed as "Osama Trader" (singular), which
-- auto-created a second active customer party. Both parties then appeared in
-- the party ledger with split balances. This migration repoints all vouchers,
-- voucher lines, and customer links to the canonical "Osama Traders" party and
-- deactivates the duplicates. Applied to production on 2026-08-05; idempotent
-- and a no-op on databases without these rows.

DO $$
DECLARE
  canonical uuid;
  duplicate uuid;
BEGIN
  SELECT id INTO canonical
  FROM accounting_parties
  WHERE name = 'Osama Traders' AND party_type = 'customer' AND is_active = true
  ORDER BY created_at
  LIMIT 1;

  IF canonical IS NULL THEN
    RETURN;
  END IF;

  FOR duplicate IN
    SELECT id FROM accounting_parties
    WHERE name = 'Osama Trader' AND party_type = 'customer' AND id <> canonical
  LOOP
    UPDATE accounting_vouchers SET party_id = canonical WHERE party_id = duplicate;
    UPDATE accounting_voucher_lines SET party_id = canonical WHERE party_id = duplicate;
    UPDATE customers
    SET accounting_party_id = canonical,
        billing_customer = 'Osama Traders'
    WHERE accounting_party_id = duplicate;
    UPDATE accounting_parties SET is_active = false, updated_at = now() WHERE id = duplicate;
  END LOOP;

  UPDATE customers
  SET billing_customer = 'Osama Traders'
  WHERE billing_customer = 'Osama Trader';
END $$;
