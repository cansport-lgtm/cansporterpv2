import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;

const SOURCE_MODULE = "production_consumption";

export interface ConsumptionPreviewRow {
  raw_material_id: string;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  cost_value: number;
  amount: number;
}

export interface ConsumptionPreview {
  date: string;
  rows: ConsumptionPreviewRow[];
  totalAmount: number;
  alreadyPosted: boolean;
  existingVoucherNumber?: string;
}

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

const findExistingVoucher = async (date: string) => {
  const { data } = await sb
    .from("accounting_vouchers")
    .select("id, voucher_number")
    .eq("source_module", SOURCE_MODULE)
    .eq("source_reference_id", date)
    .maybeSingle();
  return data;
};

/**
 * Preview the consumption JV for a given date without posting.
 * Returns the line items, total amount, and whether a voucher already exists.
 */
export async function previewProductionConsumption(date: string): Promise<ConsumptionPreview> {
  const { data: closings, error } = await sb
    .from("consumption_stock_closing")
    .select("raw_material_id, actual_consumption, raw_material:consumption_raw_materials(id, code, name, unit, cost_value)")
    .eq("closing_date", date);

  if (error) throw error;

  const rows: ConsumptionPreviewRow[] = [];
  for (const c of (closings || []) as any[]) {
    const qty = Number(c.actual_consumption || 0);
    if (qty <= 0) continue;
    const rm = c.raw_material;
    if (!rm) continue;
    const cost = Number(rm.cost_value || 0);
    rows.push({
      raw_material_id: rm.id,
      code: rm.code,
      name: rm.name,
      unit: rm.unit || "kg",
      quantity: qty,
      cost_value: cost,
      amount: qty * cost,
    });
  }
  rows.sort((a, b) => b.amount - a.amount);

  const totalAmount = rows.reduce((s, r) => s + r.amount, 0);
  const existing = await findExistingVoucher(date);

  return {
    date,
    rows,
    totalAmount,
    alreadyPosted: !!existing,
    existingVoucherNumber: existing?.voucher_number,
  };
}

export interface PostConsumptionResult {
  ok: boolean;
  skipped?: "flag_off" | "already_posted" | "nothing_to_post";
  voucherId?: string;
  voucherNumber?: string;
  totalAmount?: number;
  rowCount?: number;
  error?: string;
}

/**
 * Post the consumption JV for a given date.
 *
 *   Dr  Raw Material Consumed (5101 default)   Σ qty × cost_value
 *   Cr    Inventory — Raw Material (1130)      Σ qty × cost_value
 *
 * Idempotency: source_module + source_reference_id=date → only one voucher per day.
 * Flag-gated by VITE_ENABLE_ACC_AUTOPOST.
 */
export async function postProductionConsumption(date: string): Promise<PostConsumptionResult> {
  try {
    if (import.meta.env.VITE_ENABLE_ACC_AUTOPOST !== "true") {
      return { ok: true, skipped: "flag_off" };
    }

    const preview = await previewProductionConsumption(date);
    if (preview.alreadyPosted) {
      return { ok: true, skipped: "already_posted", voucherNumber: preview.existingVoucherNumber };
    }
    if (preview.rows.length === 0 || preview.totalAmount === 0) {
      return { ok: true, skipped: "nothing_to_post" };
    }

    // Manufacturing flow: RM consumed → moves into WIP (not directly to expense).
    // WIP is later transferred to Finished Goods via Production Output Recognition.
    const drId = await getDefaultAccount("wip_inventory");
    const crId = await getDefaultAccount("raw_material_inventory");
    if (!drId || !crId) {
      return { ok: false, error: "WIP / Raw Material Inventory accounts not mapped. Visit /accounting/default-accounts." };
    }

    const summary = preview.rows
      .slice(0, 5)
      .map((r) => `${r.code} (${r.quantity} ${r.unit})`)
      .join(", ") + (preview.rows.length > 5 ? ` and ${preview.rows.length - 5} more` : "");
    const narration = `Auto: daily material consumption — ${date}. ${summary}`;

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: date,
        narration,
        total_amount: preview.totalAmount,
        status: "posted",
        source_module: SOURCE_MODULE,
        source_reference_id: date,
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    const drLineNarration = preview.rows
      .map((r) => `${r.code} ${r.quantity}×${r.cost_value}=${r.amount.toFixed(2)}`)
      .join(" | ");

    const { error: lErr } = await sb.from("accounting_voucher_lines").insert([
      {
        voucher_id: voucher.id,
        account_id: drId,
        debit_amount: preview.totalAmount,
        credit_amount: 0,
        line_narration: `WIP — RM consumed: ${drLineNarration.slice(0, 1000)}`,
        line_order: 0,
      },
      {
        voucher_id: voucher.id,
        account_id: crId,
        debit_amount: 0,
        credit_amount: preview.totalAmount,
        line_narration: `Raw material inventory reduced — ${preview.rows.length} item(s)`,
        line_order: 1,
      },
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return {
      ok: true,
      voucherId: voucher.id,
      voucherNumber: voucher.voucher_number,
      totalAmount: preview.totalAmount,
      rowCount: preview.rows.length,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
