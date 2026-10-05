// Shared definitions for the Dispatch Planner module — a READ-ONLY planner that
// suggests a dispatch day and a load for every pending domestic order line.
// The rules live in the database: see
// supabase/migrations/20261010120100_dispatch_planner.sql (dispatch_planner_suggest).
// The planner never writes to another module's tables; its own writes (pins,
// saved versions, vehicles, settings) go through the dispatch_planner_* functions.

import { format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

// The planner tables and functions are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dpDb = supabase as any;

export const DP_MODULE = "dispatch_planner";

export type SuggestStatus = "dispatchable" | "partial" | "needs_production";

/** One row of dispatch_planner_suggest(): a pending order line (or the part of it stock covers / does not cover). */
export type SuggestRow = {
  line_key: string;
  order_item_id: string;
  part: number;
  order_id: string;
  order_number: string;
  order_date: string;
  customer_id: string;
  customer_name: string;
  city: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  grade_id: string | null;
  grade_name: string | null;
  planning_item_id: string | null;
  planning_item_name: string | null;
  packing_type: string | null;
  packing_dozens: number | null;
  pending_dozens: number;
  suggested_dozens: number;
  cartons: number;
  deadline: string | null;
  stock_closing: number | null;
  stock_closing_date: string | null;
  status: SuggestStatus;
  suggested_date: string;
  load_no: number | null;
  vehicle_id: string | null;
  vehicle_reg: string | null;
  flags: string[];
  reason: string | null;
  pinned: boolean;
  pinned_date: string | null;
  urgent: boolean;
  pin_note: string | null;
};

export type PlannerSettings = {
  horizon_days: number;
  lead_time_days: number;
  stale_closing_days: number;
  sunday_off: boolean;
  use_public_holidays: boolean;
  segments: string[];
  updated_at: string;
};

export type PlannerVehicle = {
  id: string;
  registration_no: string;
  vehicle_type: "own" | "hired";
  carton_capacity: number;
  transporter_name: string | null;
  default_driver_name: string | null;
  default_driver_contact: string | null;
  is_active: boolean;
  remarks: string | null;
  created_at: string;
  updated_at: string;
};

export type PlannerVersion = {
  id: string;
  version_number: string;
  horizon_from: string;
  horizon_to: string;
  label: string | null;
  params: { lead_time_days?: number; horizon_days?: number; fleet_cartons?: number };
  line_count: number;
  total_dozens: number;
  total_cartons: number;
  created_by: string | null;
  created_at: string;
  creator?: { full_name: string | null } | null;
};

export type PlannerVersionLine = {
  id: string;
  version_id: string;
  plan_date: string;
  load_no: number | null;
  vehicle_id: string | null;
  vehicle_reg: string | null;
  city: string | null;
  order_id: string | null;
  order_number: string | null;
  order_item_id: string | null;
  part: number;
  customer_name: string | null;
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  grade_name: string | null;
  planning_item_id: string | null;
  packing_type: string | null;
  deadline: string | null;
  suggested_dozens: number;
  cartons: number;
  status_at_save: SuggestStatus;
  flags: string[];
  pinned: boolean;
  urgent: boolean;
  reason: string | null;
};

export type WorkingDay = { day: string; is_working: boolean; reason: string | null };

// --- Labels and tones ---------------------------------------------------------

export const STATUS_META: Record<SuggestStatus, { label: string; short: string; tone: string; dot: string }> = {
  dispatchable: { label: "Dispatchable", short: "Stock", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  partial: { label: "Partial (stock covers part)", short: "Partial", tone: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
  needs_production: { label: "Needs production", short: "Produce", tone: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
};
export const statusMeta = (s: string) =>
  STATUS_META[s as SuggestStatus] ?? { label: s, short: s, tone: "bg-muted text-muted-foreground ring-border", dot: "bg-muted-foreground" };

type Severity = "high" | "medium" | "info";
export const FLAG_META: Record<string, { label: string; severity: Severity; help: string }> = {
  overdue: { label: "Overdue", severity: "high", help: "The dispatch deadline has already passed." },
  will_be_late: { label: "Will be late", severity: "high", help: "Lead time from today lands after the deadline." },
  over_fleet_capacity: { label: "Over fleet", severity: "high", help: "Every day up to the deadline is already full for the active fleet." },
  after_deadline: { label: "Pinned after deadline", severity: "medium", help: "The pinned day is after the order's deadline." },
  second_trip: { label: "2nd trip", severity: "medium", help: "More loads than vehicles on this day: a vehicle must go twice." },
  stale_stock: { label: "Stale stock", severity: "medium", help: "The latest closing stock of this item is older than the setting allows." },
  no_closing: { label: "No closing", severity: "medium", help: "The planning item has never had a daily stock closing, so stock is taken as nil." },
  no_stock_link: { label: "No planning item", severity: "medium", help: "The product has no planning item, so stock cannot be checked; taken as available." },
  no_packing: { label: "Unknown packing", severity: "info", help: "The packing type is not in the Packing Master; cartons assume 12 dozens." },
  no_deadline: { label: "No deadline", severity: "info", help: "The order has no expected dispatch date." },
  pin_ignored: { label: "Pin ignored", severity: "info", help: "The part that needs production cannot be pinned to a day." },
  urgent: { label: "Urgent", severity: "info", help: "Marked urgent by the planner; planned ahead of every deadline." },
};
export const flagMeta = (f: string) => FLAG_META[f] ?? { label: f, severity: "info" as Severity, help: "" };
export const SEVERITY_TONE: Record<Severity, string> = {
  high: "bg-red-50 text-red-700 ring-red-200",
  medium: "bg-amber-50 text-amber-700 ring-amber-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

// --- Small helpers -------------------------------------------------------------

export const fmtQty = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Today in the factory's time zone as yyyy-MM-dd. */
export const todayPk = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

export const addDaysIso = (iso: string, days: number) => {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return format(d, "yyyy-MM-dd");
};

export const fmtDay = (iso: string | null | undefined, pattern = "EEE dd MMM") => (iso ? format(parseISO(iso), pattern) : "—");

/** Calendar days from today (negative = past). */
export const daysFromToday = (iso: string | null | undefined) => {
  if (!iso) return null;
  const a = parseISO(todayPk()).getTime();
  const b = parseISO(iso).getTime();
  return Math.round((b - a) / 86_400_000);
};

export const errorMessage = (e: unknown) =>
  (e as { message?: string })?.message ?? "Something went wrong.";

/** What to tell the user when the suggestion call fails. A missing function means the
 *  module's SQL migration has not been run on the project yet. */
export const suggestErrorHint = (e: unknown) => {
  const m = errorMessage(e);
  if (/does not exist|could not find the function|PGRST202/i.test(m)) {
    return `The planner's database functions are missing (${m}). Run supabase/migrations/20261010120100_dispatch_planner.sql on the Supabase project, then reload.`;
  }
  return `The suggestion could not be computed: ${m}`;
};

export const sum = (xs: (number | null | undefined)[]) => xs.reduce((s, x) => s + Number(x ?? 0), 0);

// --- Reads -----------------------------------------------------------------------

export async function fetchSuggest(from: string, to: string): Promise<SuggestRow[]> {
  const { data, error } = await dpDb.rpc("dispatch_planner_suggest", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as SuggestRow[];
}

export async function fetchSettings(): Promise<PlannerSettings> {
  const { data, error } = await dpDb.from("dispatch_planner_settings").select("*").eq("id", true).single();
  if (error) throw error;
  return data as PlannerSettings;
}

export async function fetchVehicles(activeOnly = false): Promise<PlannerVehicle[]> {
  let q = dpDb.from("dispatch_planner_vehicles").select("*").order("carton_capacity", { ascending: false }).order("registration_no");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PlannerVehicle[];
}

export async function fetchWorkingDays(from: string, to: string): Promise<WorkingDay[]> {
  const { data, error } = await dpDb.rpc("dispatch_planner_working_days", { p_from: from, p_to: to });
  if (error) throw error;
  return (data ?? []) as WorkingDay[];
}

// --- Grouping ---------------------------------------------------------------------

export type LoadGroup = {
  load_no: number | null;
  vehicle_id: string | null;
  vehicle_reg: string | null;
  cartons: number;
  dozens: number;
  cities: string[];
  rows: SuggestRow[];
};

/** Rows of one day grouped into their loads, in load order. */
export function groupLoads(rows: SuggestRow[]): LoadGroup[] {
  const m = new Map<number, LoadGroup>();
  rows.forEach((r) => {
    const key = r.load_no ?? 0;
    const g = m.get(key) ?? { load_no: r.load_no, vehicle_id: r.vehicle_id, vehicle_reg: r.vehicle_reg, cartons: 0, dozens: 0, cities: [], rows: [] };
    g.cartons += Number(r.cartons);
    g.dozens += Number(r.suggested_dozens);
    if (r.city && !g.cities.includes(r.city)) g.cities.push(r.city);
    g.rows.push(r);
    m.set(key, g);
  });
  return [...m.values()].sort((a, b) => (a.load_no ?? 0) - (b.load_no ?? 0));
}

/** Rows grouped by suggested day, keys sorted. */
export function groupByDay(rows: SuggestRow[]): Map<string, SuggestRow[]> {
  const m = new Map<string, SuggestRow[]>();
  [...rows].sort((a, b) => a.suggested_date.localeCompare(b.suggested_date)).forEach((r) => {
    m.set(r.suggested_date, [...(m.get(r.suggested_date) ?? []), r]);
  });
  return m;
}

export const dayTotals = (rows: SuggestRow[]) => ({
  dozens: sum(rows.map((r) => r.suggested_dozens)),
  cartons: sum(rows.map((r) => r.cartons)),
  lines: rows.length,
  loads: new Set(rows.map((r) => r.load_no ?? 0)).size,
  highFlags: rows.filter((r) => r.flags.some((f) => flagMeta(f).severity === "high")).length,
  needsProduction: rows.filter((r) => r.status === "needs_production").length,
});

// --- Print -------------------------------------------------------------------------

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 11px; padding: 20px; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 2px; }
  .muted { color: #666; }
  .head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #222; padding-bottom: 8px; margin-bottom: 12px; }
  .load { border: 1px solid #bbb; border-radius: 4px; margin-bottom: 14px; page-break-inside: avoid; }
  .load .bar { background: #f1f1f1; padding: 6px 10px; font-weight: 700; display: flex; justify-content: space-between; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; border-bottom: 1px solid #222; padding: 5px 8px; font-size: 10px; text-transform: uppercase; color: #444; }
  td { padding: 5px 8px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.tick { width: 28px; text-align: center; }
  .box { display: inline-block; width: 12px; height: 12px; border: 1px solid #333; }
  .cust { background: #fafafa; font-weight: 700; }
  .flag { display: inline-block; border: 1px solid #c33; color: #c33; border-radius: 3px; padding: 0 4px; font-size: 9px; margin-left: 4px; }
  .note { margin-top: 10px; font-size: 10px; color: #555; }
  tfoot td { border-top: 2px solid #222; font-weight: 700; }
  @page { margin: 12mm; }
`;

/** Print one day's suggested loads as a loading sheet the dispatch office can tick off. Suggestions only — no prices, nothing is booked. */
export function printLoadingSuggestions(day: string, rows: SuggestRow[], opts?: { versionNumber?: string }) {
  const loads = groupLoads(rows);
  const t = dayTotals(rows);
  let html = `<div class="head"><div><h1>Suggested loading · ${esc(fmtDay(day, "EEEE dd MMMM yyyy"))}</h1>` +
    `<div class="muted">Dispatch Planner suggestion${opts?.versionNumber ? ` · ${esc(opts.versionNumber)}` : ""} · printed ${esc(format(new Date(), "dd MMM yyyy HH:mm"))}</div></div>` +
    `<div class="muted" style="text-align:right">${t.loads} load(s) · ${esc(fmtQty(t.dozens))} dz · ${t.cartons} ctn<br/>${t.needsProduction ? `${t.needsProduction} line(s) need production` : "all lines from stock"}</div></div>`;
  loads.forEach((g) => {
    html += `<div class="load"><div class="bar"><span>Load ${g.load_no ?? "—"} · ${esc(g.vehicle_reg ?? "vehicle to assign")}</span>` +
      `<span>${esc(g.cities.join(", "))} · ${esc(fmtQty(g.dozens))} dz · ${g.cartons} ctn</span></div>` +
      `<table><thead><tr><th class="tick"></th><th>Order</th><th>Product</th><th>Grade</th><th>Packing</th><th class="num">Dozens</th><th class="num">Cartons</th><th>Deadline</th></tr></thead><tbody>`;
    let lastCustomer = "";
    g.rows.forEach((r) => {
      if (r.customer_name !== lastCustomer) {
        html += `<tr class="cust"><td colspan="8">${esc(r.customer_name)}${r.city ? ` · ${esc(r.city)}` : ""}</td></tr>`;
        lastCustomer = r.customer_name;
      }
      const flags = r.flags.filter((f) => flagMeta(f).severity !== "info").map((f) => `<span class="flag">${esc(flagMeta(f).label)}</span>`).join("");
      html += `<tr><td class="tick"><span class="box"></span></td><td>${esc(r.order_number)}${r.part > 1 ? " (part 2)" : ""}</td>` +
        `<td>${esc(r.product_code ?? "")} ${esc(r.product_name ?? "")}${r.status === "needs_production" ? '<span class="flag">produce</span>' : ""}${flags}</td>` +
        `<td>${esc(r.grade_name ?? "")}</td><td>${esc(r.packing_type ?? "")}</td>` +
        `<td class="num">${esc(fmtQty(r.suggested_dozens))}</td><td class="num">${r.cartons}</td><td>${esc(fmtDay(r.deadline, "dd MMM"))}</td></tr>`;
    });
    html += `</tbody><tfoot><tr><td></td><td colspan="4">Load total</td><td class="num">${esc(fmtQty(g.dozens))}</td><td class="num">${g.cartons}</td><td></td></tr></tfoot></table></div>`;
  });
  html += `<div class="note">This is a planning suggestion. Nothing has been dispatched, reserved or booked: make the DC on the Domestic Dispatch page as usual.</div>`;
  printDocument(`Suggested loading ${day}`, `<style>${PRINT_CSS}</style>${html}`);
}

/** Flat export rows for the Pending Lines sheet. */
export const toExportRows = (rows: SuggestRow[]) =>
  rows.map((r) => ({
    "Suggested day": r.suggested_date,
    Load: r.load_no ?? "",
    Vehicle: r.vehicle_reg ?? "",
    Order: r.order_number,
    "Order date": r.order_date,
    Customer: r.customer_name,
    City: r.city ?? "",
    Product: `${r.product_code ?? ""} ${r.product_name ?? ""}`.trim(),
    Grade: r.grade_name ?? "",
    Packing: r.packing_type ?? "",
    "Pending dz": Number(r.pending_dozens),
    "Suggested dz": Number(r.suggested_dozens),
    Cartons: r.cartons,
    Deadline: r.deadline ?? "",
    Status: statusMeta(r.status).label,
    "Stock closing": r.stock_closing ?? "",
    "Closing date": r.stock_closing_date ?? "",
    Flags: r.flags.map((f) => flagMeta(f).label).join(", "),
    Reason: r.reason ?? "",
  }));
