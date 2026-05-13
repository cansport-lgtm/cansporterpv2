-- ============================================================
-- Voucher reversal: self-referencing FK linking a mirror voucher
-- back to the original it cancels. Both rows remain in the DB so
-- the audit trail is preserved; balance is achieved by the mirror
-- voucher having swapped Dr/Cr lines.
-- ============================================================

ALTER TABLE public.accounting_vouchers
  ADD COLUMN IF NOT EXISTS reverses_voucher_id UUID
    REFERENCES public.accounting_vouchers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_vouchers_reverses
  ON public.accounting_vouchers(reverses_voucher_id)
  WHERE reverses_voucher_id IS NOT NULL;
