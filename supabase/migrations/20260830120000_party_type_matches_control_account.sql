-- A party's type must match the control account its voucher line sits on:
-- Accounts Receivable carries customers, Accounts Payable carries suppliers.
--
-- Without this, a customer can be tagged onto the AP control account and the
-- voucher still balances, so nothing complains. That is how JV-202608-0069
-- ("from kidco to pak chemical") credited AP/Kidco Company instead of
-- AR/Kidco Company: Pak Chemical's payable was cleared correctly, but Kidco's
-- receivable was never reduced and a payable to a customer was invented in its
-- place. The trial balance still balanced, so it went unnoticed until Kidco
-- turned up in the Cash Flow Forecast's AP column.
--
-- Note this cannot be a CHECK constraint — the rule needs to look up
-- accounting_parties.party_type and the AR/AP account ids in
-- accounting_default_accounts, and a CHECK cannot run a subquery.
--
-- Scope: only the two mapped control accounts. Every other account (expenses
-- with an employee party, cash, bank, stock) keeps accepting any party.
CREATE OR REPLACE FUNCTION public.enforce_party_type_matches_control_account()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  ar_id UUID;
  ap_id UUID;
  ptype public.accounting_party_type;
  pname TEXT;
BEGIN
  IF NEW.party_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account_id INTO ar_id FROM public.accounting_default_accounts WHERE key = 'accounts_receivable';
  SELECT account_id INTO ap_id FROM public.accounting_default_accounts WHERE key = 'accounts_payable';

  IF NEW.account_id IS DISTINCT FROM ar_id AND NEW.account_id IS DISTINCT FROM ap_id THEN
    RETURN NEW;
  END IF;

  -- Reversals are exempt. A reversal mirrors the original's lines with Dr/Cr
  -- swapped, so undoing a historically mis-posted entry necessarily replays the
  -- bad party/account pairing. Blocking that would make the wrong entries
  -- permanent — exactly the ones this rule exists to let you clean up.
  IF EXISTS (
    SELECT 1 FROM public.accounting_vouchers
    WHERE id = NEW.voucher_id AND reverses_voucher_id IS NOT NULL
  ) THEN
    RETURN NEW;
  END IF;

  SELECT party_type, name INTO ptype, pname FROM public.accounting_parties WHERE id = NEW.party_id;

  IF NEW.account_id = ar_id AND ptype <> 'customer' THEN
    RAISE EXCEPTION 'Accounts Receivable accepts customer parties only — "%" is a %.', pname, ptype
      USING HINT = 'Post supplier balances to Accounts Payable, or change the party type in Accounting → Parties.';
  ELSIF NEW.account_id = ap_id AND ptype <> 'supplier' THEN
    RAISE EXCEPTION 'Accounts Payable accepts supplier parties only — "%" is a %.', pname, ptype
      USING HINT = 'Post customer balances to Accounts Receivable, or change the party type in Accounting → Parties.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_party_type_matches_control_account_trg ON public.accounting_voucher_lines;
CREATE TRIGGER enforce_party_type_matches_control_account_trg
BEFORE INSERT OR UPDATE ON public.accounting_voucher_lines
FOR EACH ROW EXECUTE FUNCTION public.enforce_party_type_matches_control_account();
