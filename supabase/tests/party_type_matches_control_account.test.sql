-- Tests for 20260830120000_party_type_matches_control_account.sql
--
-- Run against a scratch Postgres (NOT the live database):
--   initdb -D /tmp/pgt/data -U postgres
--   pg_ctl -D /tmp/pgt/data -o "-k /tmp/pgt -p 55432" start
--   psql -h /tmp/pgt -p 55432 -U postgres -f supabase/tests/party_type_matches_control_account.test.sql
--
-- The point of the suite is the pair of cases that pull in opposite directions:
-- a three-corner settlement legitimately touches AR and AP in ONE voucher and
-- must keep posting, while the same two accounts with a customer on the AP side
-- must be rejected. Plus the reversal exemption, without which the historic
-- mis-postings this rule exists to surface could never be undone.
\set ON_ERROR_STOP off
\pset tuples_only on

CREATE TYPE public.accounting_party_type AS ENUM ('customer','supplier','employee','other');

CREATE TABLE public.accounting_chart_of_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text, name text);
CREATE TABLE public.accounting_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text,
  party_type public.accounting_party_type NOT NULL);
CREATE TABLE public.accounting_default_accounts (key text PRIMARY KEY, account_id uuid);
CREATE TABLE public.accounting_vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), voucher_number text, narration text,
  reverses_voucher_id uuid REFERENCES public.accounting_vouchers(id));
CREATE TABLE public.accounting_voucher_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid REFERENCES public.accounting_vouchers(id),
  account_id uuid, party_id uuid,
  debit_amount numeric DEFAULT 0, credit_amount numeric DEFAULT 0);

INSERT INTO accounting_chart_of_accounts (id, code, name) VALUES
 ('d0b0724f-2748-43a8-9cfd-02ddec29ed43','1120','Accounts Receivable'),
 ('2d9e2f2d-bbfc-4d5f-8501-1b9459d2a148','2101','Accounts Payable'),
 ('11111111-1111-1111-1111-111111111111','5010','Freight Expense');
INSERT INTO accounting_parties (id, name, party_type) VALUES
 ('9fd8e73a-eca7-434e-91ec-aadc76e93747','Kidco Company','customer'),
 ('22222222-2222-2222-2222-222222222222','PAK CHEMICAL','supplier'),
 ('33333333-3333-3333-3333-333333333333','Some Employee','employee');
INSERT INTO accounting_default_accounts VALUES
 ('accounts_receivable','d0b0724f-2748-43a8-9cfd-02ddec29ed43'),
 ('accounts_payable','2d9e2f2d-bbfc-4d5f-8501-1b9459d2a148');

\i ../migrations/20260830120000_party_type_matches_control_account.sql

CREATE OR REPLACE FUNCTION t(label text, sql text, should_fail boolean) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE msg text; failed boolean := false;
BEGIN
  BEGIN EXECUTE sql; EXCEPTION WHEN others THEN failed := true; msg := SQLERRM; END;
  IF failed = should_fail THEN
    RETURN 'PASS  ' || label;
  ELSE
    RETURN 'FAIL  ' || label ||
      CASE WHEN failed THEN '  [unexpectedly blocked: '||msg||']' ELSE '  [unexpectedly allowed]' END;
  END IF;
END $$;

INSERT INTO accounting_vouchers (id, voucher_number, narration)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','JV-TEST-A','three-corner settlement');

-- A legitimate settlement: customer pays our supplier direct. AR + AP, one voucher.
SELECT t('settlement: Cr AR/Kidco (customer) allowed',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,credit_amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','d0b0724f-2748-43a8-9cfd-02ddec29ed43','9fd8e73a-eca7-434e-91ec-aadc76e93747',400000)$q$, false);
SELECT t('settlement: Dr AP/PAK CHEMICAL (supplier) allowed',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,debit_amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','2d9e2f2d-bbfc-4d5f-8501-1b9459d2a148','22222222-2222-2222-2222-222222222222',400000)$q$, false);

-- The defect this rule exists for (JV-202608-0069).
SELECT t('customer on Accounts Payable blocked',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,credit_amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','2d9e2f2d-bbfc-4d5f-8501-1b9459d2a148','9fd8e73a-eca7-434e-91ec-aadc76e93747',250000)$q$, true);
SELECT t('supplier on Accounts Receivable blocked',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,debit_amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','d0b0724f-2748-43a8-9cfd-02ddec29ed43','22222222-2222-2222-2222-222222222222',5000)$q$, true);
SELECT t('UPDATE repointing an AR line onto AP blocked',
 $q$UPDATE accounting_voucher_lines SET account_id='2d9e2f2d-bbfc-4d5f-8501-1b9459d2a148'
    WHERE party_id='9fd8e73a-eca7-434e-91ec-aadc76e93747'$q$, true);

-- Accounts outside the two control slots keep accepting any party.
SELECT t('employee on an expense account allowed',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,debit_amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333',1200)$q$, false);
SELECT t('line with no party allowed',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,debit_amount)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',NULL,900)$q$, false);

-- Reversals replay the original's party/account pairing, so they must stay exempt.
INSERT INTO accounting_vouchers (id, voucher_number, narration, reverses_voucher_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000002','JV-TEST-REV','Reversal','aaaaaaaa-0000-0000-0000-000000000001');
SELECT t('reversal voucher exempt: Dr AP/Kidco allowed',
 $q$INSERT INTO accounting_voucher_lines (voucher_id,account_id,party_id,debit_amount)
    VALUES ('bbbbbbbb-0000-0000-0000-000000000002','2d9e2f2d-bbfc-4d5f-8501-1b9459d2a148','9fd8e73a-eca7-434e-91ec-aadc76e93747',250000)$q$, false);
