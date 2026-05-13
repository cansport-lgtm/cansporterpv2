import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface PostReceiptInput {
  partyId: string;        // accounting_parties.id (customer)
  amount: number;         // PKR
  receiptDate: string;    // YYYY-MM-DD
  mode: "cash" | "bank";  // determines voucher type CRV vs BRV
  bankAccountId?: string; // required when mode='bank' — which bank account; defaults to default_bank slot
  reference?: string;     // cheque #, transaction ref, etc.
  note?: string;
}

export interface PostReceiptResult {
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
 * Record a customer receipt against their AR.
 *
 *   Dr  Cash in Hand (1101)  OR  Bank Account (1110+)   amount
 *   Cr    Accounts Receivable (1120)                    amount    (party = customer)
 *
 * Voucher type: CRV if mode='cash', BRV if mode='bank'.
 * Not idempotent — accountant intentionally records each receipt. Re-running creates duplicates.
 */
export async function postCustomerReceipt(input: PostReceiptInput): Promise<PostReceiptResult> {
  try {
    if (!isFlagOn()) return { ok: true, skipped: "flag_off" };
    if (!input.partyId) return { ok: false, error: "Missing party" };
    if (!input.amount || input.amount <= 0) return { ok: false, error: "Amount must be > 0" };

    const arId = await getDefaultAccount("accounts_receivable");
    if (!arId) return { ok: false, error: "AR account not mapped" };

    let cashOrBankId: string | null;
    if (input.mode === "cash") {
      cashOrBankId = await getDefaultAccount("default_cash");
    } else {
      cashOrBankId = input.bankAccountId || await getDefaultAccount("default_bank");
    }
    if (!cashOrBankId) return { ok: false, error: `${input.mode === "cash" ? "Cash" : "Bank"} account not configured` };

    // Look up party name for narration
    const { data: party } = await sb.from("accounting_parties").select("name").eq("id", input.partyId).maybeSingle();
    const narration = `Receipt from ${party?.name || "customer"}${input.reference ? ` — ref ${input.reference}` : ""}${input.note ? `. ${input.note}` : ""}`;

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: input.mode === "cash" ? "CRV" : "BRV",
        voucher_date: input.receiptDate,
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
      { voucher_id: voucher.id, account_id: cashOrBankId, debit_amount: input.amount, credit_amount: 0,
        line_narration: `Received via ${input.mode}`, line_order: 0 },
      { voucher_id: voucher.id, account_id: arId, party_id: input.partyId, debit_amount: 0, credit_amount: input.amount,
        line_narration: `AR settled — ${party?.name || ""}`, line_order: 1 },
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
