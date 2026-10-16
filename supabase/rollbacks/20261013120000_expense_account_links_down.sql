-- Rollback for 20261013120000_expense_account_links.sql.
-- Drops the links table (and with it every saved link), its functions and the
-- reconciliation. Petty cash, trip fuel and the ledger are not touched.

DROP FUNCTION IF EXISTS public.expense_link_reconciliation(date, date);
DROP FUNCTION IF EXISTS public.expense_account_link_delete(uuid);
DROP FUNCTION IF EXISTS public.expense_account_link_save(text, text, uuid, uuid, numeric, text, date);
DROP FUNCTION IF EXISTS public.expense_link_can(text);
DROP TABLE IF EXISTS public.expense_account_links;
