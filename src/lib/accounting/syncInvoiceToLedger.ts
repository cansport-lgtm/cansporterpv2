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
 * Invoice-is-king: keep the dispatch's AR/Sales posting equal to the INVOICED
 * total for the billing party.
 *
 * The sale is normally auto-posted at dispatch time (Dr Accounts Receivable /
 * Cr Sales) from the order price, as ONE voucher per (dispatch, billing party).
 * A dispatch can carry several shops of the same billing customer, each
 * invoiced separately — so the voucher must be reconciled against the SUM of
 * the party's invoices on the dispatch, never a single invoice's total.
 * (Syncing to one invoice used to drop its siblings: DC-00114 posted 98,400
 * because INV-0036 matched the voucher, while INV-0037's 69,180 never landed.)
 *
 * Two cases:
 *
 *   1. Voucher(s) already exist for (dispatch, party) → adjust so their sum
 *      equals the sum of the party's invoices. More than one voucher can exist
 *      (e.g. one inherited from a merged duplicate party); the delta is applied
 *      to the largest.
 *
 *   2. NO voucher exists → the sale was never posted at dispatch time (e.g. the
 *      order-item price was 0 and the real price was only entered on the
 *      invoice, so postDispatchVoucher skipped the zero-value line). Once THIS
 *      invoice is FINALIZED (status left 'draft'), create the AR/Sales voucher
 *      from the party's finalized invoices so the sale reaches the GL & P&L.
 *      Draft invoices alone are intentionally NOT posted — revenue is
 *      recognized at invoice issue.
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

    // Gather ALL of this dispatch's invoices that bill to the same party.
    const { data: dispatchInvoices } = await sb
      .from("domestic_invoices")
      .select("id, invoice_number, customer_id, total_amount, status")
      .eq("dispatch_id", invoice.dispatch_id);
    const allInvoices: any[] = dispatchInvoices || [];

    const partyByCustomer = new Map<string, string | null>([[customer.id, partyId]]);
    const otherCustomerIds = [...new Set(allInvoices.map((i) => i.customer_id))].filter(
      (id) => id && !partyByCustomer.has(id),
    );
    if (otherCustomerIds.length) {
      const { data: customerRows } = await sb
        .from("customers")
        .select("id, name, code, accounting_party_id, billing_customer")
        .in("id", otherCustomerIds);
      for (const c of (customerRows || []) as any[]) {
        partyByCustomer.set(c.id, (await resolveBillingCustomerParty(c)).partyId);
      }
    }
    const partyInvoices = allInvoices.filter((i) => partyByCustomer.get(i.customer_id) === partyId);
    const sumOf = (rows: any[]) => rows.reduce((s, i) => s + Number(i.total_amount || 0), 0);

    // Find the dispatch's AR/Sales voucher(s) for this party.
    const { data: vouchers } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number, total_amount")
      .eq("source_module", SOURCE_MODULE)
      .eq("source_reference_id", invoice.dispatch_id)
      .eq("party_id", partyId)
      .eq("status", "posted");
    const voucherList: any[] = vouchers || [];

    // ── Case 2: no voucher yet → create from finalized invoices ──────────────
    if (!voucherList.length) {
      if ((invoice.status || "draft") === "draft") return { ok: true, skipped: "draft" };
      const finalized = partyInvoices.filter((i) => (i.status || "draft") !== "draft");
      const newTotal = sumOf(finalized);
      if (newTotal <= 0) return { ok: true, skipped: "zero_total" };

      const arAccountId = await getDefaultAccount("accounts_receivable");
      const salesAccountId = await getDefaultAccount("sales_revenue_domestic");
      if (!arAccountId || !salesAccountId) {
        return { ok: false, error: "Default Sales Revenue or AR account is not configured. Visit /accounting/default-accounts." };
      }

      const displayName = (customer.billing_customer || "").trim() || customer.name;
      const invoiceLabel = finalized.map((i) => i.invoice_number).filter(Boolean).join(", ");
      const { data: created, error: cErr } = await sb
        .from("accounting_vouchers")
        .insert({
          voucher_number: "",
          voucher_type: "JV",
          voucher_date: invoice.invoice_date || new Date().toISOString().split("T")[0],
          party_id: partyId,
          narration: `Invoices ${invoiceLabel} — sales posted from invoice (${displayName})`,
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
          line_narration: `Sales revenue (domestic) — invoices ${invoiceLabel}`,
          line_order: 1,
        },
      ]);
      if (lErr) return { ok: false, error: lErr.message };

      return { ok: true, created: { amount: newTotal } };
    }

    // ── Case 1: voucher(s) exist → reconcile their sum to the invoiced sum ───
    // Once the dispatch posting exists, its revenue is already recognized, so
    // draft invoices count too — they refine the number, they don't create it.
    const expected = sumOf(partyInvoices);
    const actual = sumOf(voucherList);
    if (Math.abs(expected - actual) < 0.01) return { ok: true, skipped: "in_sync" };

    // Apply the whole delta to the largest voucher (they are 2-line AR/Sales
    // journals; keeping siblings untouched preserves their narrations).
    const target = voucherList.reduce((a, b) =>
      Number(a.total_amount || 0) >= Number(b.total_amount || 0) ? a : b,
    );
    const targetTotal = Number(target.total_amount || 0) + (expected - actual);
    if (targetTotal < 0) {
      return { ok: false, error: `Invoiced total ${expected} is below the other vouchers posted for this dispatch — adjust manually.` };
    }

    const { error: hErr } = await sb
      .from("accounting_vouchers")
      .update({ total_amount: targetTotal })
      .eq("id", target.id);
    if (hErr) return { ok: false, error: hErr.message };

    const { error: drErr } = await sb
      .from("accounting_voucher_lines")
      .update({ debit_amount: targetTotal })
      .eq("voucher_id", target.id)
      .gt("debit_amount", 0);
    if (drErr) return { ok: false, error: drErr.message };

    const { error: crErr } = await sb
      .from("accounting_voucher_lines")
      .update({ credit_amount: targetTotal })
      .eq("voucher_id", target.id)
      .gt("credit_amount", 0);
    if (crErr) return { ok: false, error: crErr.message };

    return { ok: true, updated: { voucherNumber: target.voucher_number, from: actual, to: expected } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
