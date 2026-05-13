import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;
const SOURCE_MODULE = "production_output";

export interface PostOutputResult {
  ok: boolean;
  skipped?: "flag_off" | "already_posted" | "nothing_to_post";
  voucherId?: string;
  voucherNumber?: string;
  amount?: number;
  error?: string;
}

const isFlagOn = () => import.meta.env.VITE_ENABLE_ACC_AUTOPOST === "true";

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

/**
 * Post a Production Output recognition voucher (Dr FG / Cr WIP).
 *
 *   Dr  Finished Goods Inventory (1132)   amount
 *   Cr    Work-in-Progress Inventory (1131) amount
 *
 * This is operator-initiated: the accountant tells us "Rs X worth of FG completed on date Y".
 *
 * Idempotency: source_module='production_output' + source_reference_id=date — one voucher per day.
 */
export async function postProductionOutput(date: string, amount: number, note?: string): Promise<PostOutputResult> {
  try {
    if (!isFlagOn()) return { ok: true, skipped: "flag_off" };
    if (!amount || amount <= 0) return { ok: true, skipped: "nothing_to_post" };

    // Idempotency check
    const { data: existing } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number")
      .eq("source_module", SOURCE_MODULE)
      .eq("source_reference_id", date)
      .maybeSingle();
    if (existing) return { ok: true, skipped: "already_posted", voucherNumber: existing.voucher_number };

    const drId = await getDefaultAccount("finished_goods_inventory");
    const crId = await getDefaultAccount("wip_inventory");
    if (!drId || !crId) {
      return { ok: false, error: "Finished Goods / WIP accounts not mapped. Visit /accounting/default-accounts." };
    }

    const narration = `Auto: production output completed — ${date}${note ? `. ${note}` : ""}`;

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: date,
        narration,
        total_amount: amount,
        status: "posted",
        source_module: SOURCE_MODULE,
        source_reference_id: date,
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    const { error: lErr } = await sb.from("accounting_voucher_lines").insert([
      { voucher_id: voucher.id, account_id: drId, debit_amount: amount,  credit_amount: 0, line_narration: `FG inventory increased — production output`, line_order: 0 },
      { voucher_id: voucher.id, account_id: crId, debit_amount: 0, credit_amount: amount, line_narration: `WIP transferred to FG`,                       line_order: 1 },
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number, amount };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
