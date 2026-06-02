import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface PostPurchaseReturnInput {
  partyId: string;        // accounting_parties.id (supplier)
  returnDate: string;
  amount: number;
  category: "raw_material" | "office_supplies" | "general_supplies" | "spare_maintenance";
  reference?: string;
  note?: string;
}

export interface PostPurchaseReturnResult {
  ok: boolean;
  skipped?: "flag_off";
  voucherId?: string;
  voucherNumber?: string;
  error?: string;
}

import { isAccAutopostEnabled } from "./appSettings";

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

const categoryAccountKey = (c: string): string => {
  switch (c) {
    case "raw_material": return "purchase_account_raw_material";
    case "office_supplies": return "purchase_account_office_supplies";
    case "general_supplies": return "purchase_account_general_supplies";
    case "spare_maintenance": return "purchase_account_spare_maintenance";
    default: return "purchase_account_general_supplies";
  }
};

/**
 * Record a purchase return / supplier debit note.
 *
 *   Dr  Accounts Payable (2101)             amount   (party = supplier)
 *   Cr    Inventory / Expense (per category) amount
 *
 * Reverses the original Phase 2B GRN posting for the returned portion.
 */
export async function postPurchaseReturn(input: PostPurchaseReturnInput): Promise<PostPurchaseReturnResult> {
  try {
    if (!(await isAccAutopostEnabled())) return { ok: true, skipped: "flag_off" };
    if (!input.partyId) return { ok: false, error: "Missing party" };
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be > 0" };

    const apId = await getDefaultAccount("accounts_payable");
    const reverseAccountId = await getDefaultAccount(categoryAccountKey(input.category));
    if (!apId || !reverseAccountId) return { ok: false, error: "AP or category account not mapped" };

    const { data: party } = await sb.from("accounting_parties").select("name").eq("id", input.partyId).maybeSingle();
    const narration = `Purchase return to ${party?.name || "supplier"} (${input.category})${input.reference ? ` — ref ${input.reference}` : ""}${input.note ? `. ${input.note}` : ""}`;

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: input.returnDate,
        party_id: input.partyId,
        narration,
        total_amount: input.amount,
        status: "posted",
        source_module: "manual",
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    const { error: lErr } = await sb.from("accounting_voucher_lines").insert([
      { voucher_id: voucher.id, account_id: apId, party_id: input.partyId, debit_amount: input.amount, credit_amount: 0,
        line_narration: `AP reduced — ${party?.name || ""}`, line_order: 0 },
      { voucher_id: voucher.id, account_id: reverseAccountId, debit_amount: 0, credit_amount: input.amount,
        line_narration: `Inventory/expense reversed — ${input.category}`, line_order: 1 },
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
