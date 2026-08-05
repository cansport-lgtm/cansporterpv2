-- Hard backstop against duplicate accounting parties: no two ACTIVE parties of
-- the same type may share a name (case/whitespace-insensitive). Near-miss
-- spellings ("Osama Trader" vs "Osama Traders") are handled in the app layer
-- (partyNameSimilarity.ts); this index blocks the exact-duplicate class that
-- splits a party's ledger. Inactive parties are excluded so historical
-- duplicates that were merged and deactivated can remain for audit.
CREATE UNIQUE INDEX IF NOT EXISTS accounting_parties_active_name_unique
ON accounting_parties (party_type, lower(trim(name)))
WHERE is_active;
