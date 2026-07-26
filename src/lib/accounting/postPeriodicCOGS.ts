import { supabase } from "@/integrations/supabase/client";

const sb = supabase as any;
const SOURCE_MODULE = "periodic_cogs";

export interface PeriodicCOGSPreview {
  fromDate: string;
  toDate: string;
  // Component values
  previousRMValue: number;
  currentRMValue: number;
  previousFGWIPValue: number;
  currentFGWIPValue: number;
  rmPurchasesValue: number;        // RM purchases in period (from Phase 2B GRN postings)
  // Aggregates
  previousTotalInventory: number;  // previousRM + previousFGWIP
  currentTotalInventory: number;   // currentRM + currentFGWIP
  // COGS via formula: (Previous Total + RM Purchases) − Current Total
  calculatedCOGS: number;
  // Reference info
  productionAdditions: number;     // Phase 3b production_output JVs — informational only
  alreadyPostedCOGS: number;       // Per-dispatch + prior periodic vouchers in period
  alreadyPostedDispatch: number;   // ... of which per-dispatch COGS (domestic_sales_cogs)
  alreadyPostedPeriodic: number;   // ... of which prior periodic adjustments (periodic_cogs)
  dispatchVoucherCount: number;
  periodicVoucherCount: number;
  variance: number;                // calculatedCOGS − alreadyPostedCOGS
  // Counts
  itemCounts: {
    previousFGWIP: number;
    currentFGWIP: number;
    previousRM: number;
    currentRM: number;
  };
  unpricedCount: number;
  alreadyPosted: boolean;
  existingVoucherNumber?: string;
}

const getDefaultAccount = async (key: string): Promise<string | null> => {
  const { data } = await sb.from("accounting_default_accounts").select("account_id").eq("key", key).maybeSingle();
  return data?.account_id ?? null;
};

import { isAccAutopostEnabled } from "./appSettings";

/**
 * Compute periodic COGS using both stock-closing sources + RM purchases.
 *
 * Formula:
 *   Previous Total Inventory = previous RM closing + previous FG/WIP closing
 *   Current Total Inventory  = current RM closing  + current FG/WIP closing
 *   COGS = (Previous Total Inventory + RM Purchases) − Current Total Inventory
 *
 * Logic: stock that "disappeared" from inventory between two closings, after
 * accounting for new RM purchased during the period.
 *
 * Stock-value sources:
 *   FG + WIP (Production Planning): daily_stock_closing.closing_quantity × planning_items.costing_value
 *   Raw Materials (Material Consumption): consumption_stock_closing.closing_quantity × consumption_raw_materials.standard_cost
 *   RM Purchases: sum of Phase 2B GRN voucher debits to the RM Inventory account in the period.
 */
export async function previewPeriodicCOGS(fromDate: string, toDate: string): Promise<PeriodicCOGSPreview> {
  const { data, error } = await sb.rpc("accounting_periodic_cogs_inputs", { p_from: fromDate, p_to: toDate });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) || {};

  const previousRMValue = Number(row.previous_rm_value || 0);
  const currentRMValue = Number(row.current_rm_value || 0);
  const previousFGWIPValue = Number(row.previous_fg_wip_value || 0);
  const currentFGWIPValue = Number(row.current_fg_wip_value || 0);
  const rmPurchasesValue = Number(row.rm_purchases_value || 0);
  const previousTotalInventory = previousRMValue + previousFGWIPValue;
  const currentTotalInventory = currentRMValue + currentFGWIPValue;
  const calculatedCOGS = previousTotalInventory + rmPurchasesValue - currentTotalInventory;
  const productionAdditions = Number(row.production_additions || 0);
  const alreadyPostedCOGS = Number(row.already_posted_cogs || 0);
  const alreadyPostedDispatch = Number(row.already_posted_dispatch || 0);
  const alreadyPostedPeriodic = Number(row.already_posted_periodic || 0);
  const variance = calculatedCOGS - alreadyPostedCOGS;

  const periodKey = `${fromDate}_${toDate}`;
  const { data: existing } = await sb
    .from("accounting_vouchers")
    .select("voucher_number")
    .eq("source_module", SOURCE_MODULE)
    .eq("source_reference_id", periodKey)
    .maybeSingle();

  return {
    fromDate, toDate,
    previousRMValue, currentRMValue, previousFGWIPValue, currentFGWIPValue,
    rmPurchasesValue,
    previousTotalInventory, currentTotalInventory,
    calculatedCOGS,
    productionAdditions, alreadyPostedCOGS, alreadyPostedDispatch, alreadyPostedPeriodic,
    dispatchVoucherCount: Number(row.dispatch_voucher_count || 0),
    periodicVoucherCount: Number(row.periodic_voucher_count || 0),
    variance,
    itemCounts: {
      previousFGWIP: Number(row.previous_fg_wip_items || 0),
      currentFGWIP: Number(row.current_fg_wip_items || 0),
      previousRM: Number(row.previous_rm_items || 0),
      currentRM: Number(row.current_rm_items || 0),
    },
    unpricedCount: Number(row.unpriced_fg_wip_count || 0) + Number(row.unpriced_rm_count || 0),
    alreadyPosted: !!existing,
    existingVoucherNumber: existing?.voucher_number,
  };
}

export interface PeriodicCOGSStockRow {
  code: string;
  name: string;
  unit: string | null;
  closing_date: string;
  qty: number;
  rate: number;
  value: number;
}

export interface PeriodicCOGSVoucherRow {
  voucher_number: string;
  voucher_date: string;
  source_module: string | null;
  narration: string | null;
  amount: number;
}

export interface PeriodicCOGSDetails {
  prevFG: PeriodicCOGSStockRow[];
  currFG: PeriodicCOGSStockRow[];
  prevRM: PeriodicCOGSStockRow[];
  currRM: PeriodicCOGSStockRow[];
  rmPurchases: PeriodicCOGSVoucherRow[];
  alreadyPosted: PeriodicCOGSVoucherRow[];
  production: PeriodicCOGSVoucherRow[];
}

const mapStockRows = (rows: any[]): PeriodicCOGSStockRow[] =>
  (rows || []).map((r: any) => ({ ...r, qty: Number(r.qty || 0), rate: Number(r.rate || 0), value: Number(r.value || 0) }));

const mapVoucherRows = (rows: any[]): PeriodicCOGSVoucherRow[] =>
  (rows || []).map((r: any) => ({ ...r, amount: Number(r.amount || 0) }));

/** Fetch the item-level closings and voucher lists behind each aggregate figure. */
export async function fetchPeriodicCOGSDetails(fromDate: string, toDate: string): Promise<PeriodicCOGSDetails> {
  const { data, error } = await sb.rpc("accounting_periodic_cogs_details", { p_from: fromDate, p_to: toDate });
  if (error) throw error;
  const d = data || {};
  return {
    prevFG: mapStockRows(d.prev_fg),
    currFG: mapStockRows(d.curr_fg),
    prevRM: mapStockRows(d.prev_rm),
    currRM: mapStockRows(d.curr_rm),
    rmPurchases: mapVoucherRows(d.rm_purchases),
    alreadyPosted: mapVoucherRows(d.already_posted),
    production: mapVoucherRows(d.production),
  };
}

export interface PostPeriodicCOGSResult {
  ok: boolean;
  skipped?: "flag_off" | "already_posted" | "zero_variance";
  voucherId?: string;
  voucherNumber?: string;
  variance?: number;
  error?: string;
}

export async function postPeriodicCOGS(fromDate: string, toDate: string, note?: string): Promise<PostPeriodicCOGSResult> {
  try {
    if (!(await isAccAutopostEnabled())) return { ok: true, skipped: "flag_off" };

    const preview = await previewPeriodicCOGS(fromDate, toDate);
    if (preview.alreadyPosted) return { ok: true, skipped: "already_posted", voucherNumber: preview.existingVoucherNumber };
    if (Math.abs(preview.variance) < 0.01) return { ok: true, skipped: "zero_variance" };

    const cogsId = await getDefaultAccount("cogs");
    const rmId = await getDefaultAccount("raw_material_inventory");
    if (!cogsId || !rmId) {
      return { ok: false, error: "COGS / RM Inventory accounts not mapped" };
    }

    const periodKey = `${fromDate}_${toDate}`;
    const narration = `Periodic COGS adjustment ${fromDate} → ${toDate}. ` +
      `(Previous ${preview.previousTotalInventory.toLocaleString()} + Purchases ${preview.rmPurchasesValue.toLocaleString()}) − ` +
      `Current ${preview.currentTotalInventory.toLocaleString()} = COGS ${preview.calculatedCOGS.toLocaleString()}` +
      (note ? `. ${note}` : "");

    const { data: voucher, error: vErr } = await sb
      .from("accounting_vouchers")
      .insert({
        voucher_number: "",
        voucher_type: "JV",
        voucher_date: toDate,
        narration,
        total_amount: Math.abs(preview.variance),
        status: "posted",
        source_module: SOURCE_MODULE,
        source_reference_id: periodKey,
      })
      .select("id, voucher_number")
      .single();
    if (vErr || !voucher) return { ok: false, error: vErr?.message || "Voucher insert failed" };

    // In pure periodic mode, the GL tracks inventory as one consolidated pool on
    // Raw Material Inventory (1130). The physical breakdown between RM / WIP / FG
    // lives in the operational modules (Material Consumption + Production Planning),
    // not in the GL. So the COGS adjustment is a single Dr/Cr against COGS and RM Inv.
    const lines = preview.variance > 0
      ? [
          { voucher_id: voucher.id, account_id: cogsId, debit_amount: preview.variance,  credit_amount: 0,
            line_narration: "Increase COGS to periodic-stock-based value", line_order: 0 },
          { voucher_id: voucher.id, account_id: rmId,  debit_amount: 0, credit_amount: preview.variance,
            line_narration: "Inventory reduced by stock-take (consolidated)", line_order: 1 },
        ]
      : [
          { voucher_id: voucher.id, account_id: rmId,  debit_amount: -preview.variance, credit_amount: 0,
            line_narration: "Inventory increased by stock-take (consolidated)", line_order: 0 },
          { voucher_id: voucher.id, account_id: cogsId, debit_amount: 0, credit_amount: -preview.variance,
            line_narration: "Decrease COGS to periodic-stock-based value", line_order: 1 },
        ];

    const { error: lErr } = await sb.from("accounting_voucher_lines").insert(lines);
    if (lErr) return { ok: false, error: lErr.message };

    return { ok: true, voucherId: voucher.id, voucherNumber: voucher.voucher_number, variance: preview.variance };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
