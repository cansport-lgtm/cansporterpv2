import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface PostPaymentInput {
  partyId: string;
  amount: number;
  paymentDate: string;
  mode: "cash" | "bank";
  bankAccountId?: string;
  reference?: string;
  note?: string;
}

export interface PostPaymentResult {
  ok: boolean;
  skipped?: "flag_off";
  voucherId?: string;
  voucherNumber?: string;
  error?: string;
}

const isFlagOn = () => import.meta.env.VITE_ENABLE_ACC_AUTOPOST === "true";

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

/**
 * Record a payment to a supplier against their AP.
 *
 *   Dr  Accounts Payable (2101)             amount   (party = supplier)
 *   Cr    Cash in Hand OR Bank              amount
 *
 * Voucher type: CPV if mode='cash', BPV if mode='bank'.
 */
export async function postSupplierPayment(input: PostPaymentInput): Promise<PostPaymentResult> {
  try {
    if (!isFlagOn()) return { ok: true, skipped: "flag_off" };
    if (!input.partyId) return { ok: false, error: "Missing party" };
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be > 0" };

    const apId = await getDefaultAccount("accounts_payable");
    if (!apId) return { ok: false, error: "AP account not mapped" };

    let cashOrBankId: string | null;
    if (input.mode === "cash") {
      cashOrBankId = await getDefaultAccount("default_cash");
    } else {
      cashOrBankId = input.bankAccountId || await getDefaultAccount("default_bank");
    }
    if (!cashOrBankId) return { ok: false, error: `${input.mode === "cash" ? "Cash" : "Bank"} account not configured` };

    const { data: party } = await sb.from("accounting_parties").select("name").eq("id", input.partyId).maybeSingle();
    const narration = `Payment to ${party?.name || "supplier"}${input.reference ? ` — ref ${input.reference}` : ""}${input.note ? `. ${input.note}` : ""}`;

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: input.mode === "cash" ? "CPV" : "BPV",
        voucher_date: input.paymentDate,
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
        line_narration: `AP settled — ${party?.name || ""}`, line_order: 0 },
      { voucher_id: voucher.id, account_id: cashOrBankId, debit_amount: 0, credit_amount: input.amount,
        line_narration: `Paid via ${input.mode}`, line_order: 1 },
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
