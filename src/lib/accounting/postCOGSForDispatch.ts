import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;
const SOURCE_MODULE = "domestic_sales_cogs";

export interface PostCOGSResult {
  ok: boolean;
  skipped?: "flag_off" | "perpetual_disabled" | "already_posted" | "zero_cost";
  voucherId?: string;
  voucherNumber?: string;
  amount?: number;
  zeroCostProducts?: string[];
  error?: string;
}

const isFlagOn = () => import.meta.env.VITE_ENABLE_ACC_AUTOPOST !== "false";

// Pure-periodic mode: when this is false, per-dispatch COGS doesn't fire.
// The Periodic COGS page (/accounting/periodic-cogs) becomes the sole COGS source.
// Default is false (periodic mode). Set VITE_ENABLE_PERPETUAL_COGS=true to opt into per-dispatch COGS.
const isPerpetualEnabled = () => import.meta.env.VITE_ENABLE_PERPETUAL_COGS === "true";

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

/**
 * Post a COGS recognition voucher for a freshly-created dispatch.
 *
 *   Dr  Cost of Goods Sold (5100)         Σ qty × product.standard_cost
 *   Cr    Finished Goods Inventory (1132)  Σ qty × product.standard_cost
 *
 * This is the *other half* of the Phase 2A AR/Sales posting:
 *   Phase 2A:  Dr AR / Cr Sales              (revenue recognition)
 *   Phase 3b:  Dr COGS / Cr FG               (cost-of-sale recognition)
 *
 * Together they form a complete sale entry.
 *
 * Idempotency: source_module='domestic_sales_cogs' + source_reference_id=dispatchId.
 * Note: dispatch_id is the same as the Phase 2A voucher's source_reference_id but
 * lives under a different source_module, so both vouchers can coexist for one dispatch.
 *
 * If products have standard_cost = 0, the line still posts (Rs. 0) but the affected
 * products are surfaced in `zeroCostProducts` so the accountant can fix master data.
 */
export async function postCOGSForDispatch(dispatchId: string): Promise<PostCOGSResult> {
  try {
    if (!isFlagOn()) return { ok: true, skipped: "flag_off" };
    if (!isPerpetualEnabled()) return { ok: true, skipped: "perpetual_disabled" };

    // Load dispatch + items + linked products
    const { data: dispatch, error: dErr } = await sb
      .from("sales_dispatches")
      .select("id, dispatch_number, dispatch_date, sales_segment")
      .eq("id", dispatchId)
      .single();
    if (dErr || !dispatch) return { ok: false, error: dErr?.message || "Dispatch not found" };
    if (dispatch.sales_segment && dispatch.sales_segment !== "domestic") return { ok: true, skipped: "flag_off" };

    const { data: items, error: iErr } = await sb
      .from("sales_dispatch_items")
      .select("id, quantity_dozens, order_item:sales_order_items(product_id, product:products(id, code, name, standard_cost))")
      .eq("dispatch_id", dispatchId);
    if (iErr) return { ok: false, error: iErr.message };
    if (!items || items.length === 0) return { ok: true, skipped: "zero_cost" };

    // Idempotency
    const { data: existing } = await sb
      .from("accounting_vouchers")
      .select("id, voucher_number")
      .eq("source_module", SOURCE_MODULE)
      .eq("source_reference_id", dispatchId)
      .maybeSingle();
    if (existing) return { ok: true, skipped: "already_posted", voucherNumber: existing.voucher_number };

    // Compute cost + collect zero-cost product names for warning
    let totalCost = 0;
    const zeroCostProducts: string[] = [];
    const breakdown: string[] = [];
    for (const it of items as any[]) {
      const product = it.order_item?.product;
      if (!product) continue;
      const cost = Number(product.standard_cost || 0);
      const qty = Number(it.quantity_dozens || 0);
      const lineAmount = qty * cost;
      totalCost += lineAmount;
      if (cost === 0) zeroCostProducts.push(product.code || product.name);
      breakdown.push(`${product.code || product.name} ${qty}×${cost}=${lineAmount.toFixed(2)}`);
    }

    if (totalCost === 0) {
      return { ok: true, skipped: "zero_cost", zeroCostProducts, amount: 0 };
    }

    const cogsId = await getDefaultAccount("cogs");
    const fgId = await getDefaultAccount("finished_goods_inventory");
    if (!cogsId || !fgId) {
      return { ok: false, error: "COGS / Finished Goods accounts not mapped. Visit /accounting/default-accounts." };
    }

    const narration = `Auto: COGS for dispatch ${dispatch.dispatch_number || dispatchId.slice(0, 8)}` +
      (zeroCostProducts.length ? ` (⚠ ${zeroCostProducts.length} zero-cost items)` : "");

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: dispatch.dispatch_date || new Date().toISOString().split("T")[0],
        narration,
        total_amount: totalCost,
        status: "posted",
        source_module: SOURCE_MODULE,
        source_reference_id: dispatchId,
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    const { error: lErr } = await sb.from("accounting_voucher_lines").insert([
      {
        voucher_id: voucher.id, account_id: cogsId,
        debit_amount: totalCost, credit_amount: 0,
        line_narration: `COGS — ${breakdown.join(" | ").slice(0, 1000)}`,
        line_order: 0,
      },
      {
        voucher_id: voucher.id, account_id: fgId,
        debit_amount: 0, credit_amount: totalCost,
        line_narration: `FG inventory reduced — ${items.length} item line(s)`,
        line_order: 1,
      },
    ]);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number, amount: totalCost, zeroCostProducts };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
