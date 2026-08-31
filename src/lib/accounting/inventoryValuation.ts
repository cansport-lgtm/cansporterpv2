import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "./fetchAllRows";

const sb = supabase as any;

/** One "latest closing per item" row, as returned by the snapshot RPC. */
export interface ClosingSnapshotRow {
  item_id: string;
  closing_date: string;
  qty: number;
}

export interface FGItemMaster {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  department_id: string;
  threshold_inventory: number | null;
  costing_value: number | null;
  is_active: boolean | null;
}

export interface DepartmentMaster {
  id: string;
  code: string;
  name: string;
  sequence_order: number | null;
}

export interface RMItemMaster {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  category: string | null;
  threshold: number | null;
  cost_value: number | null;
  source_product_id: string | null;
  is_active: boolean | null;
}

/** Raw closing row used for the trend window (and the no-RPC fallback). */
export interface ClosingWindowRow {
  item_id: string;
  closing_date: string;
  qty: number;
}

export async function fetchFGMasters(): Promise<{ items: FGItemMaster[]; departments: DepartmentMaster[] }> {
  const [itemsRes, deptsRes] = await Promise.all([
    sb.from("planning_items").select("id, code, name, unit, department_id, threshold_inventory, costing_value, is_active"),
    sb.from("production_departments").select("id, code, name, sequence_order"),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (deptsRes.error) throw deptsRes.error;
  return { items: itemsRes.data || [], departments: deptsRes.data || [] };
}

export async function fetchRMMasters(): Promise<RMItemMaster[]> {
  const { data, error } = await sb
    .from("consumption_raw_materials")
    .select("id, code, name, unit, category, threshold, cost_value, source_product_id, is_active");
  if (error) throw error;
  return data || [];
}

/**
 * All closing rows in [fromDate, toDate] for the 14-day trend (and as the
 * latest-per-item fallback when the snapshot RPC is not deployed yet).
 */
export async function fetchClosingWindow(kind: "fg" | "rm", fromDate: string, toDate: string): Promise<ClosingWindowRow[]> {
  const table = kind === "fg" ? "daily_stock_closing" : "consumption_stock_closing";
  const idCol = kind === "fg" ? "planning_item_id" : "raw_material_id";
  const rows = await fetchAllRows((from, to) =>
    sb
      .from(table)
      .select(`${idCol}, closing_date, closing_quantity`)
      .gte("closing_date", fromDate)
      .lte("closing_date", toDate)
      .order("id", { ascending: true })
      .range(from, to));
  return rows.map((r: any) => ({
    item_id: r[idCol],
    closing_date: r.closing_date,
    qty: Number(r.closing_quantity) || 0,
  }));
}

/**
 * Latest closing per item on or before asOf, across all history, via the
 * accounting_inventory_snapshot RPC. Returns null when the function is not
 * deployed yet so the caller can fall back to the window-derived latest.
 */
export async function fetchInventorySnapshot(asOf: string): Promise<{ fg: ClosingSnapshotRow[]; rm: ClosingSnapshotRow[] } | null> {
  const { data, error } = await sb.rpc("accounting_inventory_snapshot", { p_as_of: asOf });
  if (error) {
    // PGRST202 = function not found (migration not applied yet).
    if (error.code === "PGRST202" || /accounting_inventory_snapshot/.test(error.message || "")) return null;
    throw error;
  }
  return {
    fg: ((data?.fg || []) as any[]).map((r) => ({ item_id: r.item_id, closing_date: r.closing_date, qty: Number(r.qty) || 0 })),
    rm: ((data?.rm || []) as any[]).map((r) => ({ item_id: r.item_id, closing_date: r.closing_date, qty: Number(r.qty) || 0 })),
  };
}

/** Reduce a closing window to the latest row per item (fallback path). */
export function latestPerItem(rows: ClosingWindowRow[]): ClosingSnapshotRow[] {
  const latest = new Map<string, ClosingWindowRow>();
  rows.forEach((r) => {
    const prev = latest.get(r.item_id);
    if (!prev || r.closing_date > prev.closing_date) latest.set(r.item_id, r);
  });
  return Array.from(latest.values());
}

export interface GLBalance {
  accountCode: string;
  accountName: string;
  balance: number;
}

/**
 * Net Dr − Cr balance of the default account(s) mapped to the given keys, as
 * of a date. Mirrors TrialBalancePage (all voucher lines up to the date, no
 * status filter) so the recon strip agrees with the Trial Balance the user
 * sees. Keys with no mapped account are skipped; returns null when none of
 * the keys is mapped.
 */
export async function fetchInventoryGLBalance(keys: string[], asOf: string): Promise<GLBalance | null> {
  const { data: defaults, error } = await sb
    .from("accounting_default_accounts")
    .select("key, account_id")
    .in("key", keys);
  if (error) throw error;
  const accountIds: string[] = (defaults || []).map((d: any) => d.account_id).filter(Boolean);
  if (!accountIds.length) return null;

  const { data: accounts, error: accErr } = await sb
    .from("accounting_chart_of_accounts")
    .select("id, code, name")
    .in("id", accountIds);
  if (accErr) throw accErr;

  const lines = await fetchAllRows((from, to) =>
    sb
      .from("accounting_voucher_lines")
      .select("account_id, debit_amount, credit_amount, voucher:accounting_vouchers!inner(voucher_date)")
      .in("account_id", accountIds)
      .lte("voucher.voucher_date", asOf)
      .order("id", { ascending: true })
      .range(from, to));
  const balance = lines.reduce((s: number, l: any) => s + (Number(l.debit_amount) || 0) - (Number(l.credit_amount) || 0), 0);

  const sorted = (accounts || []).sort((a: any, b: any) => a.code.localeCompare(b.code));
  return {
    accountCode: sorted.map((a: any) => a.code).join(" + "),
    accountName: sorted.map((a: any) => a.name).join(" + "),
    balance,
  };
}
