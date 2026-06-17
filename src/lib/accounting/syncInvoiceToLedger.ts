import { supabase } from "@/integrations/supabase/client";
import { resolveBillingCustomerParty } from "./getCustomerBillingParty";

const sb = supabase as any;

const SOURCE_MODULE = "domestic_sales";

export interface SyncInvoiceResult {
  ok: boolean;
  updated?: { voucherNumber: string; from: number; to: number };
  created?: { amount: number };
  skipped?: "no_party" | "no_voucher" | "in_sync" | "draft" | "zero_total";
  error?: string;
}

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data, error } = await sb
    .from("accounting_default_accounts")
    .select("account_id")
    .eq("key", key)
    .maybeSingle();
  if (error || !data?.account_id) return null;
  return data.account_id as string;
};

/**
 * Invoice-is-king: keep the dispatch's AR/Sales voucher equal to the invoice total.
 *
 * The sale is normally auto-posted at dispatch time (Dr Accounts Receivable /
 * Cr Sales) from the order price. Two cases are handled here:
 *
 *   1. A voucher already exists → update its header total + AR debit line +
 *      Sales credit line to match the (possibly edited) invoice total.
 *
 *   2. NO voucher exists → the sale was never posted at dispatch time (e.g. the
 *      order-item price was 0 and the real price was only entered on the
 *      invoice, so postDispatchVoucher skipped the zero-value line). Once the
 *      invoice is FINALIZED (status left 'draft') and carries a value, create
 *      the AR/Sales voucher from the invoice so the sale reaches the GL & P&L.
 *      Draft invoices are intentionally NOT posted — revenue is recognized at
 *      invoice issue.
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
      .select("id, invoice_number, dispatch_id, customer_id, total_amount, status, invoice_date")
      .eq("id", invoiceId)
      .maybeSingle();
    if (invErr || !invoice) return { ok: false, error: invErr?.message || "Invoice not found" };
    if (!invoice.dispatch_id) return { ok: true, skipped: "no_voucher" };

    // Resolve the invoice customer's BILLING party — that's the party the AR
    // voucher was (or will be) posted against.
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
      .eq("source_module", SOURCE_MODULE)
      .eq("source_reference_id", invoice.dispatch_id)
      .eq("party_id", partyId)
      .eq("status", "posted");
    const voucher = (vouchers || [])[0];

    const newTotal = Number(invoice.total_amount || 0);

    // ── Case 2: no voucher yet → create from the invoice (if finalized) ──────
    if (!voucher) {
      if ((invoice.status || "draft") === "draft") return { ok: true, skipped: "draft" };
      if (newTotal <= 0) return { ok: true, skipped: "zero_total" };

      const arAccountId = await getDefaultAccount("accounts_receivable");
      const salesAccountId = await getDefaultAccount("sales_revenue_domestic");
      if (!arAccountId || !salesAccountId) {
        return { ok: false, error: "Default Sales Revenue or AR account is not configured. Visit /accounting/default-accounts." };
      }

      const displayName = (customer.billing_customer || "").trim() || customer.name;
      const { data: created, error: cErr } = await sb
        .from("accounting_vouchers")
        .insert({
          voucher_number: "",
          voucher_type: "JV",
          voucher_date: invoice.invoice_date || new Date().toISOString().split("T")[0],
          party_id: partyId,
          narration: `Invoice ${invoice.invoice_number || ""} — sales posted from invoice (${displayName})`,
          total_amount: newTotal,
          status: "posted",
          source_module: SOURCE_MODULE,
          source_reference_id: invoice.dispatch_id,
        })
        .select("id")
        .single();
      if (cErr || !created) return { ok: false, error: cErr?.message || "Failed to create sales voucher" };

      const { error: lErr } = await sb.from("accounting_voucher_lines").insert([
        {
          voucher_id: created.id,
          account_id: arAccountId,
          party_id: partyId,
          debit_amount: newTotal,
          credit_amount: 0,
          line_narration: `AR — ${displayName}`,
          line_order: 0,
        },
        {
          voucher_id: created.id,
          account_id: salesAccountId,
          party_id: null,
          debit_amount: 0,
          credit_amount: newTotal,
          line_narration: `Sales revenue (domestic) — invoice ${invoice.invoice_number || ""}`,
          line_order: 1,
        },
      ]);
      if (lErr) return { ok: false, error: lErr.message };

      return { ok: true, created: { amount: newTotal } };
    }

    // ── Case 1: voucher exists → keep it in sync ─────────────────────────────
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
