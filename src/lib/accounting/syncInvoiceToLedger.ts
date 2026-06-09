import { supabase } from "@/integrations/supabase/client";
import { resolveBillingCustomerParty } from "./getCustomerBillingParty";

const sb = supabase as any;

export interface SyncInvoiceResult {
  ok: boolean;
  updated?: { voucherNumber: string; from: number; to: number };
  skipped?: "no_party" | "no_voucher" | "in_sync";
  error?: string;
}

/**
 * Invoice-is-king: keep the dispatch's AR/Sales voucher equal to the invoice total.
 *
 * The sale is auto-posted at dispatch time (Dr Accounts Receivable / Cr Sales) from
 * the order price. When a user later edits the invoice (e.g. applies a discount or
 * corrects a rate), the invoice becomes the true receivable — so we update that
 * dispatch voucher (header total + its AR debit line + its Sales credit line) to
 * match the invoice's total.
 *
 * COGS is intentionally left untouched: it reflects the physical goods shipped
 * (quantity x standard cost), which a price/discount change does not affect.
 *
 * Idempotent (re-running with an already-matching total is a no-op) and never throws.
 */
export async function syncInvoiceToLedger(invoiceId: string): Promise<SyncInvoiceResult> {
  try {
    const { data: invoice, error: invErr } = await sb
      .from("domestic_invoices")
      .select("id, dispatch_id, customer_id, total_amount")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return { ok: false, error: invErr?.message || "Invoice not found" };
    if (!invoice.dispatch_id) return { ok: true, skipped: "no_voucher" };

    // Resolve the invoice customer's BILLING party — that's the party the AR
    // voucher was posted against.
    const { data: customer } = await sb
      .from("customers")
      .select("id, name, code, accounting_party_id, billing_customer")
      .eq("id", invoice.customer_id)
      .maybeSingle();
    if (!customer) return { ok: true, skipped: "no_party" };

    const { partyId } = await resolveBillingCustomerParty(customer);
    if (!partyId) return { ok: true, skipped: "no_party" };

    // Find the dispatch's AR/Sales voucher for this party.
    const { data: vouchers } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number, total_amount")
      .eq("source_module", "domestic_sales")
      .eq("source_reference_id", invoice.dispatch_id)
      .eq("party_id", partyId)
      .eq("status", "posted");
    const voucher = (vouchers || [])[0];
    if (!voucher) return { ok: true, skipped: "no_voucher" };

    const newTotal = Number(invoice.total_amount || 0);
    const oldTotal = Number(voucher.total_amount || 0);
    if (Math.abs(newTotal - oldTotal) < 0.01) return { ok: true, skipped: "in_sync" };

    // Update header + the two lines (one debit = AR, one credit = Sales).
    const { error: hErr } = await sb
      .from("accounting_vouchers")
      .update({ total_amount: newTotal })
      .eq("id", voucher.id);
    if (hErr) return { ok: false, error: hErr.message };

    const { error: drErr } = await sb
      .from("accounting_voucher_lines")
      .update({ debit_amount: newTotal })
      .eq("voucher_id", voucher.id)
      .gt("debit_amount", 0);
    if (drErr) return { ok: false, error: drErr.message };

    const { error: crErr } = await sb
      .from("accounting_voucher_lines")
      .update({ credit_amount: newTotal })
      .eq("voucher_id", voucher.id)
      .gt("credit_amount", 0);
    if (crErr) return { ok: false, error: crErr.message };

    return { ok: true, updated: { voucherNumber: voucher.voucher_number, from: oldTotal, to: newTotal } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
