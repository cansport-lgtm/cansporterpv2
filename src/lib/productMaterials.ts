// Product materials (Products / SKUs material columns) and the raw-material
// stock check that runs when an order is confirmed / approved.
//
// The check itself lives in the database (material_check_run, see migration
// 20261022120000): this module only reads its results, runs previews and
// formats numbers. The system SUGGESTS quantities to buy; it never creates a
// purchase order and never blocks an order.
import { supabase } from "@/integrations/supabase/client";

// New tables / functions are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const db = supabase as any;

export type SlotKey =
  | "felt"
  | "stamp_logo"
  | "packing_roll"
  | "theli"
  | "bags"
  | "sleeve"
  | "cartons";

export interface MaterialSlot {
  key: SlotKey;
  label: string;
  sort_order: number;
  category_id: string | null;
  subcategory_id: string | null;
  customer_override: boolean;
}

export interface ProductMaterial {
  id: string;
  product_id: string;
  slot: SlotKey;
  item_id: string;
  qty_per_dozen: number;
  wastage_pct: number;
}

export interface MaterialItem {
  id: string;
  code: string | null;
  name: string;
  raw_material_category_id: string | null;
  raw_material_subcategory_id: string | null;
  min_stock: number | null;
  max_stock: number | null;
  unit: string;
  subcategory_name: string | null;
}

export interface ItemStock {
  item_id: string;
  item_name: string;
  unit: string;
  closing_frequency: string;
  last_count_date: string | null;
  stock_now: number | null;
  stock_known: boolean;
  count_is_old: boolean;
  min_stock: number;
  max_stock: number;
}

export type CheckResult = "ok" | "short" | "below_min" | "unknown" | "not_set";

export interface CheckLine {
  item_id: string | null;
  item_name: string;
  unit: string | null;
  slots: string | null;
  used_by: string | null;
  needed: number;
  stock_now: number | null;
  last_count_date: string | null;
  stock_after: number | null;
  min_stock: number | null;
  max_stock: number | null;
  result: CheckResult;
  count_is_old: boolean;
  suggest_qty: number | null;
  purchase_status?: PurchaseStatus;
  po_reference?: string | null;
}

export type PurchaseStatus = "new" | "seen" | "po_raised" | "received";

export interface MaterialCheck {
  id: string;
  source_type: SourceType;
  source_id: string;
  order_number: string | null;
  order_label: string | null;
  reason: "confirmed" | "updated";
  status: "open" | "superseded" | "closed";
  short_count: number;
  below_min_count: number;
  unknown_count: number;
  not_set_count: number;
  old_count: number;
  ok_count: number;
  created_at: string;
}

export type SourceType = "sales_order" | "distributor_order";

export const SLOT_KEYS: SlotKey[] = [
  "felt",
  "stamp_logo",
  "packing_roll",
  "theli",
  "bags",
  "sleeve",
  "cartons",
];

// ---------------------------------------------------------------- loaders

export async function fetchSlots(): Promise<MaterialSlot[]> {
  const { data, error } = await db
    .from("product_material_slots")
    .select("key, label, sort_order, category_id, subcategory_id, customer_override")
    .order("sort_order");
  if (error) throw error;
  return data as MaterialSlot[];
}

export async function fetchProductMaterials(): Promise<ProductMaterial[]> {
  const rows: ProductMaterial[] = [];
  // Page through: one row per product per column can pass the 1000-row cap.
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("product_materials")
      .select("id, product_id, slot, item_id, qty_per_dozen, wastage_pct")
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as ProductMaterial[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

// Active raw-material items that can be picked in a material column.
export async function fetchMaterialItems(): Promise<MaterialItem[]> {
  const { data, error } = await db
    .from("items")
    .select(
      "id, code, name, raw_material_category_id, raw_material_subcategory_id, min_stock, max_stock, units_of_measure(symbol), consumption_subcategories(name)",
    )
    .eq("category", "raw_material")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((i: Record<string, unknown>) => ({
    id: i.id as string,
    code: (i.code as string) ?? null,
    name: i.name as string,
    raw_material_category_id: (i.raw_material_category_id as string) ?? null,
    raw_material_subcategory_id: (i.raw_material_subcategory_id as string) ?? null,
    min_stock: (i.min_stock as number) ?? null,
    max_stock: (i.max_stock as number) ?? null,
    unit: ((i.units_of_measure as { symbol?: string } | null)?.symbol ?? "") as string,
    subcategory_name:
      ((i.consumption_subcategories as { name?: string } | null)?.name ?? null) as string | null,
  }));
}

export async function fetchItemStock(itemIds: string[]): Promise<Map<string, ItemStock>> {
  const map = new Map<string, ItemStock>();
  if (itemIds.length === 0) return map;
  const { data, error } = await db.rpc("item_stock_now", { p_item_ids: itemIds });
  if (error) throw error;
  for (const row of (data ?? []) as ItemStock[]) map.set(row.item_id, row);
  return map;
}

export async function previewCheck(sourceType: SourceType, sourceId: string): Promise<CheckLine[]> {
  const { data, error } = await db.rpc("material_check_preview", {
    p_source_type: sourceType,
    p_source_id: sourceId,
  });
  if (error) throw error;
  return (data ?? []) as CheckLine[];
}

// Latest saved check (any status) for an order, with its lines.
export async function fetchLatestCheck(
  sourceType: SourceType,
  sourceId: string,
): Promise<{ check: MaterialCheck; lines: CheckLine[] } | null> {
  const { data, error } = await db
    .from("material_checks")
    .select("*")
    .eq("source_type", sourceType)
    .eq("source_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const check = (data?.[0] ?? null) as MaterialCheck | null;
  if (!check) return null;
  const { data: lines, error: lErr } = await db
    .from("material_check_lines")
    .select("*")
    .eq("check_id", check.id);
  if (lErr) throw lErr;
  return { check, lines: sortLines((lines ?? []) as CheckLine[]) };
}

// ---------------------------------------------------------------- helpers

const RESULT_ORDER: Record<CheckResult, number> = {
  short: 1,
  unknown: 2,
  not_set: 3,
  below_min: 4,
  ok: 5,
};

export function sortLines(lines: CheckLine[]): CheckLine[] {
  return [...lines].sort(
    (a, b) =>
      RESULT_ORDER[a.result] - RESULT_ORDER[b.result] ||
      Number(b.count_is_old) - Number(a.count_is_old) ||
      a.item_name.localeCompare(b.item_name),
  );
}

export function issueCounts(lines: CheckLine[]) {
  const c = { short: 0, below_min: 0, unknown: 0, not_set: 0, old: 0, ok: 0 };
  for (const l of lines) {
    if (l.result === "ok") c.ok++;
    else c[l.result]++;
    if (l.count_is_old && l.result !== "unknown") c.old++;
  }
  return c;
}

export function hasIssues(lines: CheckLine[]): boolean {
  return lines.some((l) => l.result !== "ok" || l.count_is_old);
}

export function fmtQty(n: number | null | undefined, unit?: string | null): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  const v = Number(n);
  const s = v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) < 10 ? 3 : 1 });
  return unit ? `${s} ${unit}` : s;
}

export const RESULT_LABEL: Record<CheckResult, string> = {
  short: "Short",
  below_min: "Below min stock",
  unknown: "Stock unknown",
  not_set: "Materials not set",
  ok: "OK",
};

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  new: "Not seen",
  seen: "Seen",
  po_raised: "PO raised",
  received: "Received",
};

// One-line summary used in toasts.
export function summarize(lines: CheckLine[]): string {
  const c = issueCounts(lines);
  const parts: string[] = [];
  if (c.short) parts.push(`${c.short} short`);
  if (c.below_min) parts.push(`${c.below_min} below min stock`);
  if (c.unknown) parts.push(`${c.unknown} stock unknown`);
  if (c.not_set) parts.push(`${c.not_set} product(s) with materials not set`);
  if (c.old) parts.push(`${c.old} old count`);
  return parts.join(" · ");
}
