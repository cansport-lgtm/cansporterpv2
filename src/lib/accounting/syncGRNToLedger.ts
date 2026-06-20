import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface SyncGRNResult {
  ok: boolean;
  updated?: { voucherNumber: string; from: number; to: number };
  skipped?: "no_voucher" | "in_sync";
  error?: string;
}

/**
 * Keep a GRN's auto-posted AP/Inventory voucher in step with the GRN after a
 * price/amount edit. Mirrors syncInvoiceToLedger: the GRN is the source of
 * truth, so we update the existing purchase voucher (header total + its Dr
 * Inventory/Expense line and Cr Accounts Payable line) to the GRN's amount
 * (invoice_amount if set, else total_amount — same rule as postGRNVoucher).
 *
 * Idempotent (a matching total is a no-op) and never throws. If no voucher was
 * posted yet (auto-post was off at creation) it skips — repost via Purchase
 * Reconciliation instead.
 */
export async function syncGRNToLedger(grnId: string): Promise<SyncGRNResult> {
  try {
    const { data: grn, error } = await sb
      .from("goods_receipt_notes")
      .select("id, invoice_amount, total_amount")
      .eq("id", grnId)
      .maybeSingle();
    if (error || !grn) return { ok: false, error: error?.message || "GRN not found" };

    const amount = Number(grn.invoice_amount || grn.total_amount || 0);

    const { data: vouchers } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number, total_amount")
      .eq("source_module", "purchase")
      .eq("source_reference_id", grnId)
      .eq("status", "posted");
    const voucher = (vouchers || [])[0];
    if (!voucher) return { ok: true, skipped: "no_voucher" };

    const oldTotal = Number(voucher.total_amount || 0);
    if (Math.abs(amount - oldTotal) < 0.01) return { ok: true, skipped: "in_sync" };

    const { error: hErr } = await sb.from("accounting_vouchers").update({ total_amount: amount }).eq("id", voucher.id);
    if (hErr) return { ok: false, error: hErr.message };

    const { error: drErr } = await sb
      .from("accounting_voucher_lines")
      .update({ debit_amount: amount })
      .eq("voucher_id", voucher.id)
      .gt("debit_amount", 0);
    if (drErr) return { ok: false, error: drErr.message };

    const { error: crErr } = await sb
      .from("accounting_voucher_lines")
      .update({ credit_amount: amount })
      .eq("voucher_id", voucher.id)
      .gt("credit_amount", 0);
    if (crErr) return { ok: false, error: crErr.message };

    return { ok: true, updated: { voucherNumber: voucher.voucher_number, from: oldTotal, to: amount } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
