import { supabase } from "@/integrations/supabase/client";
import { grnRecoveredFreight } from "./postGRNVoucher";

const sb = supabase as any;

export interface SyncGRNResult {
  ok: boolean;
  updated?: { voucherNumber: string; from: number; to: number };
  skipped?: "no_voucher" | "in_sync";
  error?: string;
}

/**
 * Keep a GRN's auto-posted AP/Inventory voucher in step with the GRN after a
 * price/amount or freight edit. Mirrors syncInvoiceToLedger: the GRN is the
 * source of truth, so we update the existing purchase voucher (header total +
 * its Dr Inventory/Expense line and Cr Accounts Payable line) to the GRN's
 * amount (invoice_amount if set, else total_amount — same rule as
 * postGRNVoucher). Freight recovered from the supplier is credited to Freight
 * Inward instead of Accounts Payable, the same split postGRNVoucher makes.
 *
 * Idempotent (a matching voucher is a no-op) and never throws. If no voucher
 * was posted yet (auto-post was off at creation) it skips — repost via
 * Purchase Reconciliation instead.
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
    const recovered = await grnRecoveredFreight(grnId);
    if (recovered > amount + 0.001) {
      return { ok: false, error: `Freight recovered (Rs. ${recovered}) is more than the GRN amount (Rs. ${amount}).` };
    }

    const { data: vouchers } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number, total_amount")
      .eq("source_module", "purchase")
      .eq("source_reference_id", grnId)
      .eq("status", "posted");
    const voucher = (vouchers || [])[0];
    if (!voucher) return { ok: true, skipped: "no_voucher" };

    const { data: freightAcc } = await sb
      .from("accounting_default_accounts").select("account_id").eq("key", "freight_inward").maybeSingle();
    const freightId: string | null = freightAcc?.account_id ?? null;

    const { data: lines, error: lnErr } = await sb
      .from("accounting_voucher_lines")
      .select("id, account_id, debit_amount, credit_amount")
      .eq("voucher_id", voucher.id);
    if (lnErr) return { ok: false, error: lnErr.message };
    const credits = (lines || []).filter((l: any) => Number(l.credit_amount) > 0);
    const freightLine = freightId ? credits.find((l: any) => l.account_id === freightId) : undefined;
    const apLines = credits.filter((l: any) => l !== freightLine);

    const oldTotal = Number(voucher.total_amount || 0);
    const oldRecovered = Number(freightLine?.credit_amount || 0);
    if (Math.abs(amount - oldTotal) < 0.01 && Math.abs(recovered - oldRecovered) < 0.01) {
      return { ok: true, skipped: "in_sync" };
    }
    if (recovered > 0 && !freightId) {
      return { ok: false, error: "Freight Inward account not mapped (needed to recover freight from the supplier). Visit /accounting/default-accounts." };
    }

    const { error: hErr } = await sb.from("accounting_vouchers").update({ total_amount: amount }).eq("id", voucher.id);
    if (hErr) return { ok: false, error: hErr.message };

    const { error: drErr } = await sb
      .from("accounting_voucher_lines")
      .update({ debit_amount: amount })
      .eq("voucher_id", voucher.id)
      .gt("debit_amount", 0);
    if (drErr) return { ok: false, error: drErr.message };

    if (apLines.length) {
      const { error: crErr } = await sb
        .from("accounting_voucher_lines")
        .update({ credit_amount: amount - recovered })
        .in("id", apLines.map((l: any) => l.id));
      if (crErr) return { ok: false, error: crErr.message };
    }

    if (freightLine && recovered <= 0) {
      const { error: dErr } = await sb.from("accounting_voucher_lines").delete().eq("id", freightLine.id);
      if (dErr) return { ok: false, error: dErr.message };
    } else if (freightLine) {
      const { error: fErr } = await sb.from("accounting_voucher_lines").update({ credit_amount: recovered }).eq("id", freightLine.id);
      if (fErr) return { ok: false, error: fErr.message };
    } else if (recovered > 0) {
      const { error: iErr } = await sb.from("accounting_voucher_lines").insert({
        voucher_id: voucher.id,
        account_id: freightId,
        debit_amount: 0,
        credit_amount: recovered,
        line_narration: "Freight paid by us, recovered from the supplier",
        line_order: 2,
      });
      if (iErr) return { ok: false, error: iErr.message };
    }

    return { ok: true, updated: { voucherNumber: voucher.voucher_number, from: oldTotal, to: amount } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
