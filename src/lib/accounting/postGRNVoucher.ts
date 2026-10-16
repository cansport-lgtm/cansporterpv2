import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;
const SOURCE_MODULE = "purchase";

export interface PostGRNResult {
  ok: boolean;
  skipped?: "flag_off" | "already_posted";
  voucherId?: string;
  voucherNumber?: string;
  amount?: number;
  error?: string;
}

import { isAccAutopostEnabled } from "./appSettings";

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

const categoryAccountKey = (category: string | null | undefined): string => {
  // Maps purchase_orders.category enum → default-account slot key
  switch (category) {
    case "raw_material": return "purchase_account_raw_material";
    case "office_supplies": return "purchase_account_office_supplies";
    case "general_supplies": return "purchase_account_general_supplies";
    case "spare_maintenance": return "purchase_account_spare_maintenance";
    default: return "purchase_account_general_supplies"; // fallback
  }
};

const getOrCreateAccountingParty = async (supplier: { id: string; name: string; code?: string | null; accounting_party_id?: string | null }): Promise<string | null> => {
  if (supplier.accounting_party_id) return supplier.accounting_party_id;
  const { data: created, error } = await sb
    .from("accounting_parties")
    .insert({
      name: supplier.name,
      code: supplier.code || null,
      party_type: "supplier",
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !created) return null;
  await sb.from("suppliers").update({ accounting_party_id: created.id }).eq("id", supplier.id);
  return created.id as string;
};

/**
 * Freight the company paid the transporter and recovers from the supplier
 * ("to pay" freight, grn_freight.payer = 'company_recover'); 0 otherwise.
 * Missing table (migration not applied) or no access reads as 0.
 */
export const grnRecoveredFreight = async (grnId: string): Promise<number> => {
  const { data, error } = await sb.from("grn_freight").select("payer, amount").eq("grn_id", grnId).maybeSingle();
  if (error || !data || data.payer !== "company_recover") return 0;
  return Number(data.amount || 0);
};

/**
 * Auto-post AP/Inventory journal for a freshly-created GRN.
 *
 *   Dr  Inventory or Expense (per PO category)     amount
 *   Cr    Accounts Payable                          amount − recovered   (party = supplier)
 *   Cr    Freight Inward                            recovered            (only when freight is recovered)
 *
 * Recovered freight: we paid the supplier's transporter in cash (a freight
 * voucher, booked to Freight Inward when paid), so the supplier is owed that
 * much less and the expense nets to nil.
 *
 * Idempotency: source_module='purchase' + source_reference_id=grnId.
 * Flag-gated by VITE_ENABLE_ACC_AUTOPOST. Never throws.
 */
export async function postGRNVoucher(grnId: string): Promise<PostGRNResult> {
  try {
    if (!(await isAccAutopostEnabled())) return { ok: true, skipped: "flag_off" };

    // 1) Load GRN + related supplier + PO category
    const { data: grn, error: gErr } = await sb
      .from("goods_receipt_notes")
      .select(
        "id, grn_number, receipt_date, total_amount, invoice_amount, supplier_id, purchase_order_id, " +
        "supplier:suppliers(id, name, code, accounting_party_id), " +
        "purchase_order:purchase_orders(id, po_number, category)"
      )
      .eq("id", grnId)
      .single();
    if (gErr || !grn) return { ok: false, error: gErr?.message || "GRN not found" };

    const amount = Number(grn.invoice_amount || grn.total_amount || 0);
    if (amount <= 0) return { ok: true, skipped: "already_posted" }; // nothing to post

    // 2) Idempotency
    const { data: existing } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number")
      .eq("source_module", SOURCE_MODULE)
      .eq("source_reference_id", grnId)
      .maybeSingle();
    if (existing) return { ok: true, skipped: "already_posted", voucherNumber: existing.voucher_number };

    // 3) Resolve accounts
    const apId = await getDefaultAccount("accounts_payable");
    const drId = await getDefaultAccount(categoryAccountKey(grn.purchase_order?.category));
    if (!apId || !drId) {
      return { ok: false, error: "Accounts Payable or category Dr account not mapped. Visit /accounting/default-accounts." };
    }
    const recovered = await grnRecoveredFreight(grnId);
    if (recovered > amount + 0.001) {
      return { ok: false, error: `Freight recovered (Rs. ${recovered}) is more than the GRN amount (Rs. ${amount}).` };
    }
    const freightId = recovered > 0 ? await getDefaultAccount("freight_inward") : null;
    if (recovered > 0 && !freightId) {
      return { ok: false, error: "Freight Inward account not mapped (needed to recover freight from the supplier). Visit /accounting/default-accounts." };
    }

    // 4) Resolve party
    const supplier = grn.supplier;
    if (!supplier) return { ok: false, error: "GRN supplier missing" };
    const partyId = await getOrCreateAccountingParty(supplier);
    if (!partyId) return { ok: false, error: "Failed to create/find accounting party for supplier" };

    // 5) Insert voucher + lines
    const narration = `Auto: GRN ${grn.grn_number} from ${supplier.name}` +
      (grn.purchase_order?.po_number ? ` (PO ${grn.purchase_order.po_number})` : "") +
      (grn.purchase_order?.category ? ` — ${grn.purchase_order.category}` : "") +
      (recovered > 0 ? ` · freight Rs. ${recovered.toLocaleString()} recovered` : "");

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: grn.receipt_date || new Date().toISOString().split("T")[0],
        party_id: partyId,
        narration,
        total_amount: amount,
        status: "posted",
        source_module: SOURCE_MODULE,
        source_reference_id: grnId,
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    const { error: lErr } = await sb.from("accounting_voucher_lines").insert([
      {
        voucher_id: voucher.id,
        account_id: drId,
        debit_amount: amount,
        credit_amount: 0,
        line_narration: `Purchase received — ${grn.purchase_order?.category || "general"}`,
        line_order: 0,
      },
      {
        voucher_id: voucher.id,
        account_id: apId,
        party_id: partyId,
        debit_amount: 0,
        credit_amount: amount - recovered,
        line_narration: `AP — ${supplier.name}`,
        line_order: 1,
      },
      ...(recovered > 0 ? [{
        voucher_id: voucher.id,
        account_id: freightId,
        debit_amount: 0,
        credit_amount: recovered,
        line_narration: `Freight paid by us, recovered from ${supplier.name}`,
        line_order: 2,
      }] : []),
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number, amount };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
