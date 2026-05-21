import { supabase } from "@/integrations/supabase/client";
import { postSalesReturn } from "@/lib/accounting/postSalesReturn";

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
      .select("id, return_date, return_number, customer_id, total_amount, cogs_amount, reason, notes, status, accounting_voucher_id")
      .eq("id", returnId)
      .single();
    if (rErr || !r) return { ok: false, error: rErr?.message || "Return not found" };
    if (r.status === "posted" && r.accounting_voucher_id) {
      return { ok: true, voucherId: r.accounting_voucher_id, skipped: "already_posted" };
    }
    if (!r.customer_id) return { ok: false, error: "Return has no customer" };

    // Resolve the customer's accounting_party_id; create one if missing (mirrors the
    // dispatch auto-post behavior so AR/return postings line up against the same party).
    const { data: customer } = await sb
      .from("customers")
      .select("id, name, code, accounting_party_id")
      .eq("id", r.customer_id)
      .maybeSingle();
    if (!customer) return { ok: false, error: "Customer not found" };

    let partyId: string | null = customer.accounting_party_id;
    if (!partyId) {
      const { data: newParty, error: pErr } = await sb
        .from("accounting_parties")
        .insert({ name: customer.name, code: customer.code || null, party_type: "customer", is_active: true })
        .select("id")
        .single();
      if (pErr) return { ok: false, error: pErr.message };
      partyId = newParty.id;
      await sb.from("customers").update({ accounting_party_id: partyId }).eq("id", customer.id);
    }

    const result = await postSalesReturn({
      partyId: partyId!,
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
