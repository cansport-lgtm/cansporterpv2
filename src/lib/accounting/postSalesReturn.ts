import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface PostSalesReturnInput {
  partyId: string;        // accounting_parties.id (customer)
  returnDate: string;
  salesAmount: number;    // amount of the original sale being reversed
  cogsAmount: number;     // cost basis of the returned goods (typically qty × product.standard_cost)
  reference?: string;     // credit note #, original invoice reference
  note?: string;
}

export interface PostSalesReturnResult {
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
 * Record a sales return / customer credit note.
 *
 * Two-sided reversal (matching the original sale's two postings):
 *   Revenue side:  Dr Sales Returns (4010)    salesAmount
 *                  Cr   Accounts Receivable    salesAmount    (party = customer)
 *   Cost side:     Dr Finished Goods Inventory cogsAmount     (returns FG to stock)
 *                  Cr   COGS (5100)            cogsAmount
 *
 * Both legs are bundled into ONE multi-line journal voucher so the entry is self-balancing.
 * If the user doesn't know the COGS amount, set cogsAmount=0 — the cost side is skipped.
 */
export async function postSalesReturn(input: PostSalesReturnInput): Promise<PostSalesReturnResult> {
  try {
    if (!isFlagOn()) return { ok: true, skipped: "flag_off" };
    if (!input.partyId) return { ok: false, error: "Missing party" };
    if (!input.salesAmount || input.salesAmount <= 0) return { ok: false, error: "Sales amount must be > 0" };

    const salesReturnsId = await getDefaultAccount("sales_returns");
    const arId = await getDefaultAccount("accounts_receivable");
    if (!salesReturnsId || !arId) return { ok: false, error: "Sales Returns or AR account not mapped" };

    const fgId = await getDefaultAccount("finished_goods_inventory");
    const cogsId = await getDefaultAccount("cogs");

    const { data: party } = await sb.from("accounting_parties").select("name").eq("id", input.partyId).maybeSingle();
    const totalDebit = input.salesAmount + (input.cogsAmount > 0 ? input.cogsAmount : 0);
    const narration = `Sales return from ${party?.name || "customer"}${input.reference ? ` — ref ${input.reference}` : ""}${input.note ? `. ${input.note}` : ""}`;

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: input.returnDate,
        party_id: input.partyId,
        narration,
        total_amount: totalDebit,
        status: "posted",
        source_module: "manual",
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    const lines = [
      { voucher_id: voucher.id, account_id: salesReturnsId, debit_amount: input.salesAmount, credit_amount: 0,
        line_narration: `Sales return — revenue reversed`, line_order: 0 },
      { voucher_id: voucher.id, account_id: arId, party_id: input.partyId, debit_amount: 0, credit_amount: input.salesAmount,
        line_narration: `AR reduced — ${party?.name || ""}`, line_order: 1 },
    ];
    if (input.cogsAmount > 0 && fgId && cogsId) {
      lines.push(
        { voucher_id: voucher.id, account_id: fgId, debit_amount: input.cogsAmount, credit_amount: 0,
          line_narration: `FG restored to inventory`, line_order: 2 } as any,
        { voucher_id: voucher.id, account_id: cogsId, debit_amount: 0, credit_amount: input.cogsAmount,
          line_narration: `COGS reversed`, line_order: 3 } as any,
      );
    }
    const { error: lErr } = await sb.from("accounting_voucher_lines").insert(lines);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
