import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

export interface ReverseVoucherResult {
  ok: boolean;
  reversalVoucherId?: string;
  reversalVoucherNumber?: string;
  error?: string;
}

/**
 * Reverse an existing voucher by creating a mirror voucher with Dr/Cr swapped.
 *
 *   Original (status flips to 'reversed'):
 *     Dr  X   amount
 *     Cr    Y amount
 *
 *   New reversal voucher (status='posted', reverses_voucher_id=original.id):
 *     Dr  Y   amount
 *     Cr    X amount
 *
 * Mathematically the two cancel out — the original's GL impact is undone, and
 * the audit trail is preserved (both vouchers remain in the DB).
 *
 * Blocked by the period-close trigger if voucher_date is in a closed period.
 */
export async function reverseVoucher(originalVoucherId: string, reason: string): Promise<ReverseVoucherResult> {
  try {
    if (!originalVoucherId) return { ok: false, error: "Missing voucher id" };
    if (!reason || !reason.trim()) return { ok: false, error: "A reason is required" };

    // 1) Load original voucher + lines
    const { data: original, error: oErr } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number, voucher_type, voucher_date, party_id, narration, total_amount, status, source_module, source_reference_id, reverses_voucher_id")
      .eq("id", originalVoucherId)
      .single();
    if (oErr || !original) return { ok: false, error: oErr?.message || "Original voucher not found" };

    if (original.status === "reversed") return { ok: false, error: "Voucher is already reversed" };
    if (original.reverses_voucher_id) return { ok: false, error: "This is itself a reversal voucher — cannot reverse a reversal" };

    const { data: lines, error: lErr } = await sb
      .from("accounting_voucher_lines")
      .select("*")
      .eq("voucher_id", originalVoucherId)
      .order("line_order");
    if (lErr || !lines || lines.length === 0) return { ok: false, error: lErr?.message || "Original has no lines" };

    // 2) Insert reversal voucher
    const reversalNarration =
      `Reversal of ${original.voucher_number}: ${reason.trim()}` +
      (original.narration ? `\n— original narration: ${original.narration}` : "");

    const { data: reversal, error: rErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: original.voucher_date,
        party_id: original.party_id,
        narration: reversalNarration,
        total_amount: original.total_amount,
        status: "posted",
        source_module: "manual",
        source_reference_id: original.id,        // pointer to original for queryability
        reverses_voucher_id: original.id,
      })
      .select("id, voucher_number")
      .single();
    if (rErr || !reversal) return { ok: false, error: rErr?.message || "Failed to insert reversal voucher" };

    // 3) Insert mirror lines (Dr ↔ Cr swapped)
    const mirrorLines = (lines as any[]).map((line, idx) => ({
      voucher_id: reversal.id,
      account_id: line.account_id,
      party_id: line.party_id,
      debit_amount: Number(line.credit_amount || 0),     // swap
      credit_amount: Number(line.debit_amount || 0),     // swap
      line_narration: line.line_narration ? `Reversal: ${line.line_narration}` : "Reversal",
      line_order: idx,
    }));
    const { error: mlErr } = await sb.from("accounting_voucher_lines").insert(mirrorLines);
    if (mlErr) return { ok: false, error: mlErr.message };

    // 4) Mark original as reversed
    const { error: uErr } = await sb
      .from("accounting_vouchers")
      .update({ status: "reversed", updated_at: new Date().toISOString() })
      .eq("id", originalVoucherId);
    if (uErr) return { ok: false, error: uErr.message };

    return { ok: true, reversalVoucherId: reversal.id, reversalVoucherNumber: reversal.voucher_number };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
