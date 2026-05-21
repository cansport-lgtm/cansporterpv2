import { supabase } from "@/integrations/supabase/client";
import { postPurchaseReturn } from "@/lib/accounting/postPurchaseReturn";

const sb = supabase as any;

export interface ProcessPurchaseReturnResult {
  ok: boolean;
  voucherId?: string;
  voucherNumber?: string;
  skipped?: string;
  error?: string;
}

/**
 * Post a purchase return to accounting. Looks up the supplier's accounting_party_id,
 * calls postPurchaseReturn with the total + category, then stamps the return row
 * with status='posted' and the resulting accounting_voucher_id.
 */
export async function processPurchaseReturn(returnId: string): Promise<ProcessPurchaseReturnResult> {
  try {
    const { data: r, error: rErr } = await sb
      .from("purchase_returns")
      .select("id, return_date, return_number, supplier_id, category, total_amount, reason, notes, status, accounting_voucher_id")
      .eq("id", returnId)
      .single();
    if (rErr || !r) return { ok: false, error: rErr?.message || "Return not found" };
    if (r.status === "posted" && r.accounting_voucher_id) {
      return { ok: true, voucherId: r.accounting_voucher_id, skipped: "already_posted" };
    }
    if (!r.supplier_id) return { ok: false, error: "Return has no supplier" };

    const { data: supplier } = await sb
      .from("suppliers")
      .select("id, name, code, accounting_party_id")
      .eq("id", r.supplier_id)
      .maybeSingle();
    if (!supplier) return { ok: false, error: "Supplier not found" };

    let partyId: string | null = supplier.accounting_party_id;
    if (!partyId) {
      const { data: newParty, error: pErr } = await sb
        .from("accounting_parties")
        .insert({ name: supplier.name, code: supplier.code || null, party_type: "supplier", is_active: true })
        .select("id")
        .single();
      if (pErr) return { ok: false, error: pErr.message };
      partyId = newParty.id;
      await sb.from("suppliers").update({ accounting_party_id: partyId }).eq("id", supplier.id);
    }

    const result = await postPurchaseReturn({
      partyId: partyId!,
      returnDate: r.return_date,
      amount: Number(r.total_amount || 0),
      category: r.category,
      reference: r.return_number,
      note: r.reason || r.notes || undefined,
    });
    if (!result.ok) return { ok: false, error: result.error };
    if (result.skipped) return { ok: true, skipped: result.skipped };

    await sb
      .from("purchase_returns")
      .update({ status: "posted", accounting_voucher_id: result.voucherId })
      .eq("id", returnId);

    return { ok: true, voucherId: result.voucherId, voucherNumber: result.voucherNumber };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
