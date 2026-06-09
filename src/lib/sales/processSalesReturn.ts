import { supabase } from "@/integrations/supabase/client";
import { postSalesReturn } from "@/lib/accounting/postSalesReturn";
import { resolveBillingCustomerParty } from "@/lib/accounting/getCustomerBillingParty";

const sb = supabase as any;

export interface ProcessSalesReturnResult {
  ok: boolean;
  voucherId?: string;
  voucherNumber?: string;
  skipped?: string;
  error?: string;
}

/**
 * Post a sales return to accounting. Looks up the customer's accounting_party_id,
 * calls postSalesReturn with the sale + cogs totals, then stamps the return row
 * with status='posted' and the resulting accounting_voucher_id.
 */
export async function processSalesReturn(returnId: string): Promise<ProcessSalesReturnResult> {
  try {
    const { data: r, error: rErr } = await sb
      .from("sales_returns")
      .select("id, return_date, return_number, customer_id, dispatch_id, total_amount, cogs_amount, reason, notes, status, accounting_voucher_id")
      .eq("id", returnId)
      .single();
    if (rErr || !r) return { ok: false, error: rErr?.message || "Return not found" };
    if (r.status === "posted" && r.accounting_voucher_id) {
      return { ok: true, voucherId: r.accounting_voucher_id, skipped: "already_posted" };
    }
    if (!r.customer_id) return { ok: false, error: "Return has no customer" };

    // Only the Domestic module is financial. Private-label / export sales never
    // post AR/Sales/COGS, so their returns must not post a reversal either
    // (mirrors postDispatchVoucher / postCOGSForDispatch self-gating).
    if (r.dispatch_id) {
      const { data: disp } = await sb
        .from("sales_dispatches")
        .select("sales_segment")
        .eq("id", r.dispatch_id)
        .maybeSingle();
      if (disp?.sales_segment && disp.sales_segment !== "domestic") {
        return { ok: true, skipped: "non_domestic" };
      }
    }

    // Resolve the customer's BILLING customer party (mirrors the dispatch
    // auto-post behavior so AR/return postings line up against the same party).
    // Ship-to shops with no billing customer are skipped rather than posted.
    const { data: customer } = await sb
      .from("customers")
      .select("id, name, code, accounting_party_id, billing_customer")
      .eq("id", r.customer_id)
      .maybeSingle();
    if (!customer) return { ok: false, error: "Customer not found" };

    const { partyId, skipped } = await resolveBillingCustomerParty(customer);
    if (!partyId) {
      if (skipped === "no_billing_customer") {
        return { ok: true, skipped: "no_billing_customer" };
      }
      return { ok: false, error: "Could not resolve a billing customer for this return." };
    }

    const result = await postSalesReturn({
      partyId,
      returnDate: r.return_date,
      salesAmount: Number(r.total_amount || 0),
      cogsAmount: Number(r.cogs_amount || 0),
      reference: r.return_number,
      note: r.reason || r.notes || undefined,
    });
    if (!result.ok) return { ok: false, error: result.error };
    if (result.skipped) return { ok: true, skipped: result.skipped };

    await sb
      .from("sales_returns")
      .update({ status: "posted", accounting_voucher_id: result.voucherId })
      .eq("id", returnId);

    return { ok: true, voucherId: result.voucherId, voucherNumber: result.voucherNumber };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
