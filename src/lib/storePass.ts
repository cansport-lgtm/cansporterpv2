// Shared definitions for the Store Pass module (finished goods handed over by
// the store at the loading dock, before the gate).
// The rules live in the database: see supabase/migrations/20261008120100_store_pass.sql
// and 20261009120000_store_pass_simplify.sql.
// Every write goes through its store_pass_* functions; the tables are read-only here.

import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

// The store pass tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const spDb = supabase as any;

export type StorePassStatus = "draft" | "issued" | "cancelled";

export const SP_STATUS_META: Record<StorePassStatus, { label: string; variant: "warning" | "success" | "destructive" | "secondary" | "info" | "soft" }> = {
  draft: { label: "Draft", variant: "secondary" },
  issued: { label: "Issued", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};
export const spStatusMeta = (s: string) =>
  SP_STATUS_META[s as StorePassStatus] ?? { label: s, variant: "secondary" as const };

export type StorePassItem = {
  id: string;
  line_no: number;
  dispatch_id: string | null;
  dispatch_item_id: string | null;
  product_id: string | null;
  description: string;
  packing_type: string | null;
  uom: string;
  dispatch_quantity: number | null;
  dispatch_packages: number | null;
  quantity: number;
  packages: number | null;
  remarks: string | null;
  products?: { code: string; name: string } | null;
};

export type StorePassDispatchRef = {
  dispatch_id: string;
  sales_dispatches: {
    dispatch_number: string;
    dispatch_date: string;
    delivery_status: string;
    vehicle_number: string | null;
  } | null;
};

export type StorePass = {
  id: string;
  pass_number: string;
  status: StorePassStatus;
  pass_date: string;
  dispatch_plan_no: string | null;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_contact: string | null;
  party_name: string;
  received_by_name: string | null;
  store_location: string | null;
  photo_path: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  issued_by: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  creator?: { full_name: string | null } | null;
  issuer?: { full_name: string | null } | null;
  canceller?: { full_name: string | null } | null;
  store_pass_items?: StorePassItem[];
  store_pass_dispatches?: StorePassDispatchRef[];
};

export const SP_SELECT =
  "*," +
  "creator:app_users!store_passes_created_by_fkey(full_name)," +
  "issuer:app_users!store_passes_issued_by_fkey(full_name)," +
  "canceller:app_users!store_passes_cancelled_by_fkey(full_name)," +
  "store_pass_items(*, products(code, name))," +
  "store_pass_dispatches(dispatch_id, sales_dispatches(dispatch_number, dispatch_date, delivery_status, vehicle_number))";

export const fmtQty = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const sortedItems = (p: StorePass) =>
  [...(p.store_pass_items ?? [])].sort((a, b) => a.line_no - b.line_no);

export const totals = (items: Pick<StorePassItem, "quantity" | "packages">[]) => ({
  quantity: items.reduce((s, i) => s + Number(i.quantity), 0),
  packages: items.reduce((s, i) => s + Number(i.packages ?? 0), 0),
});

/** Today in the factory's time zone as yyyy-MM-dd. */
export const todayPk = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

/** Supabase/PostgREST error → readable message (the store_pass_* functions raise plain sentences). */
export const errorMessage = (e: unknown) =>
  (e as { message?: string })?.message ?? "Something went wrong.";

const fmtDateTime = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "");

/** Print the store pass. No prices are ever on it. `qrSvg` is the QR's outerHTML. */
export function printStorePass(p: StorePass, qrSvg: string) {
  const items = sortedItems(p);
  const t = totals(items);
  const linked = (p.store_pass_dispatches ?? []).map((d) => d.sales_dispatches?.dispatch_number).filter(Boolean).join(", ");
  const rows = items
    .map((i, n) => `<tr>
        <td>${n + 1}</td>
        <td>${esc(i.description)}</td>
        <td class="right">${i.packages ?? ""}</td>
        <td class="right">${esc(fmtQty(i.quantity))}</td>
        <td>${esc(i.remarks ?? "")}</td>
      </tr>`)
    .join("");
  const body = `
  <style>
    .sp table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .sp th, .sp td { border: 1px solid #bbb; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: top; }
    .sp th { background: #f1f3f7; }
    .sp .right { text-align: right; }
    .sp .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; }
    .sp .sign { display: flex; gap: 16px; margin-top: 56px; }
    .sp .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; text-align: center; }
  </style>
  <div class="wrap sp">
    <div class="head">
      <div>
        <h1>Cansport Global Industries</h1>
        <div class="muted xs">Finished Goods Store</div>
        <div class="bold" style="margin-top:8px; letter-spacing:.08em; font-size:15px">STORE PASS</div>
        ${p.status === "draft" ? `<div class="bold" style="color:#b42318">DRAFT — NOT ISSUED</div>` : ""}
        ${p.status === "cancelled" ? `<div class="bold" style="color:#b42318">CANCELLED</div>` : ""}
      </div>
      <div style="text-align:center">${qrSvg}<div class="xs muted">${esc(p.pass_number)}</div></div>
    </div>
    <div class="facts">
      <div><span class="muted">SP no.</span> <b style="font-size:15px">${esc(p.pass_number)}</b></div>
      <div><span class="muted">Date</span> <b>${esc(format(new Date(p.pass_date), "dd MMM yyyy"))}</b></div>
      <div><span class="muted">Dispatch plan no.</span> <b style="font-size:14px">${esc(p.dispatch_plan_no ?? "")}</b></div>
      <div><span class="muted">Handed over to</span> <b>${esc(p.received_by_name ?? "")}</b></div>
      ${p.issued_at ? `<div><span class="muted">Issued</span> <b>${esc(fmtDateTime(p.issued_at))}</b></div>` : ""}
      ${linked ? `<div><span class="muted">Dispatches</span> <b>${esc(linked)}</b></div>` : ""}
    </div>
    <table>
      <thead><tr><th>#</th><th>Item</th><th class="right">Cartons</th><th class="right">Dozens</th><th>Remark</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2" class="right bold">Total handed over</td><td class="right bold">${t.packages}</td><td class="right bold">${esc(fmtQty(t.quantity))}</td><td></td></tr></tfoot>
    </table>
    ${p.remarks ? `<p style="font-size:12px">Remarks: ${esc(p.remarks)}</p>` : ""}
    <p class="xs muted">Goods listed above were handed over by the Finished Goods Store at the loading dock. This pass travels with the goods to the gate, where the guard counts against the gate pass. No prices are shown.</p>
    <div class="sign">
      <div>Store keeper<br><b>${esc(p.issuer?.full_name ?? p.creator?.full_name ?? "")}</b></div>
      <div>Handed over to<br><b>${esc(p.received_by_name ?? "")}</b></div>
      <div>Gate security<br>Gate pass no. ________</div>
    </div>
  </div>`;
  printDocument(p.pass_number, body);
}

// Store pass no. / status for dispatch lists (read-only extra column).
// Who links store passes to system dispatches (the dispatch sheet). The store
// keeper (store_pass_officer) only makes passes; the dispatch operator links.
// Mirrors store_pass_can_link() in the database.
export const STORE_PASS_LINK_ROLES = ["super_admin", "store_pass_manager", "gate_pass_manager", "dispatch_operator", "sales_order_manager"];
export const canLinkStorePass = (roles: { role: string }[]) => roles.some((r) => STORE_PASS_LINK_ROLES.includes(r.role));
// One store pass ↔ one dispatch. Once linked, changing or removing the link is a
// correction: super admin only (mirrors store_pass_link_dispatches).
export const canCorrectStorePassLink = (roles: { role: string }[]) => roles.some((r) => r.role === "super_admin");

// One row of store_pass_link_candidates(dispatch_id): a pass the operator could put the dispatch on.
export type LinkCandidate = {
  store_pass_id: string;
  pass_number: string;
  status: string;
  pass_date: string;
  dispatch_plan_no: string | null;
  received_by_name: string | null;
  issued_at: string | null;
  created_by_name: string | null;
  quantity: number;
  packages: number;
  item_count: number;
  linked_count: number;
  linked_dispatches: string | null;
  is_current: boolean;
  plan_matches: boolean | null;
};

export type DispatchStorePass = {
  dispatch_id: string;
  store_pass_id: string;
  pass_number: string;
  status: string;
  issued_at: string | null;
};

const CHUNK = 150;

/** The live store pass (if any) of each dispatch id, keyed by dispatch id. */
export function useDispatchStorePasses(dispatchIds: string[]) {
  const ids = [...new Set(dispatchIds)].sort();
  const { data } = useQuery<Map<string, DispatchStorePass>>({
    queryKey: ["dispatch-store-pass", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const map = new Map<string, DispatchStorePass>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data: rows, error } = await spDb
          .from("v_dispatch_store_pass")
          .select("dispatch_id, store_pass_id, pass_number, status, issued_at")
          .in("dispatch_id", ids.slice(i, i + CHUNK));
        // The view is missing until the store pass migration is applied — show blanks, never break the page.
        if (error) return map;
        (rows as DispatchStorePass[]).forEach((r) => map.set(r.dispatch_id, r));
      }
      return map;
    },
  });
  return data ?? new Map<string, DispatchStorePass>();
}

// One row of v_store_gate_tracking: a domestic dispatch and how far it has got.
export type TrackingStage =
  | "no_store_pass" | "draft" | "issued" | "on_gate_pass" | "held" | "out" | "delivered" | "returned";

export type TrackingRow = {
  dispatch_id: string;
  dispatch_number: string;
  dispatch_date: string;
  dispatch_created_at: string;
  delivery_status: string;
  dc_vehicle: string | null;
  actual_delivery_date: string | null;
  acknowledgement_date: string | null;
  customer_name: string | null;
  order_numbers: string | null;
  dc_quantity: number;
  dc_packages: number;
  store_pass_id: string | null;
  sp_number: string | null;
  sp_status: string | null;
  sp_issued_at: string | null;
  sp_dispatch_plan_no: string | null;
  sp_received_by: string | null;
  sp_created_at: string | null;
  sp_dispatch_count: number | null;
  sp_quantity: number | null;
  sp_packages: number | null;
  gate_pass_id: string | null;
  gp_number: string | null;
  gp_status: string | null;
  gp_created_at: string | null;
  gp_held_at: string | null;
  gate_out_at: string | null;
  gp_vehicle: string | null;
  gate_vehicle_number: string | null;
  gp_quantity: number | null;
  gp_packages: number | null;
  gp_counted_packages: number | null;
  gp_counted_quantity: number | null;
  stage: TrackingStage;
};

export const STAGE_META: Record<TrackingStage, { label: string; tone: string; order: number }> = {
  no_store_pass: { label: "No store pass", tone: "bg-red-50 text-red-800 ring-red-200", order: 0 },
  draft: { label: "Store pass draft", tone: "bg-slate-100 text-slate-700 ring-slate-200", order: 1 },
  issued: { label: "Issued, no gate pass", tone: "bg-indigo-50 text-indigo-800 ring-indigo-200", order: 2 },
  on_gate_pass: { label: "On gate pass, waiting", tone: "bg-sky-50 text-sky-800 ring-sky-200", order: 3 },
  held: { label: "Held at gate", tone: "bg-amber-50 text-amber-800 ring-amber-200", order: 4 },
  out: { label: "Out · in transit", tone: "bg-emerald-50 text-emerald-800 ring-emerald-200", order: 5 },
  delivered: { label: "Delivered", tone: "bg-slate-100 text-slate-700 ring-slate-200", order: 6 },
  returned: { label: "Returned", tone: "bg-slate-100 text-slate-700 ring-slate-200", order: 7 },
};
export const stageMeta = (s: string) => STAGE_META[s as TrackingStage] ?? STAGE_META.no_store_pass;

/** Hours between two timestamps as "2h 40m" (or "—"). */
export function hoursBetween(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return "—";
  const mins = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 48) return `${Math.round(h / 24)} d`;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

// ---------------------------------------------------------------------------
// Daily store ↔ gate reconciliation (store_pass_reconcile, step 2)

export type DiscrepancyCode =
  | "OUT_NO_SP" | "SP_NOT_OUT" | "SP_VS_GP" | "SP_VS_DC" | "DC_CHANGED"
  | "SP_CANCELLED_AFTER_ISSUE" | "CROSS_DAY" | "DC_PENDING" | "SP_UNLINKED";

export type Severity = "high" | "medium" | "info";

export const DISCREPANCY_META: Record<DiscrepancyCode, { label: string; severity: Severity; help: string }> = {
  OUT_NO_SP: { label: "Out without store pass", severity: "high", help: "The vehicle left the gate and the store never issued a store pass for this dispatch." },
  SP_NOT_OUT: { label: "Issued, not out", severity: "high", help: "The store handed the goods over but they have not left the gate." },
  SP_VS_GP: { label: "Store ≠ gate", severity: "high", help: "What the store issued differs from what the guard counted at the gate." },
  SP_VS_DC: { label: "Store ≠ DC", severity: "medium", help: "What the store handed over differs from the dispatch as it is now. The office corrects the dispatch, or the store explains." },
  DC_CHANGED: { label: "DC changed after issue", severity: "medium", help: "The office edited the dispatch after the store pass was issued." },
  SP_UNLINKED: { label: "Not linked to a dispatch", severity: "medium", help: "The store issued this pass but it is not linked to any system dispatch, so nothing can be compared yet. The dispatch operator links it from the Domestic Dispatch page (Store pass column)." },
  SP_CANCELLED_AFTER_ISSUE: { label: "Issued pass cancelled", severity: "info", help: "An issued store pass for this dispatch was cancelled by a manager." },
  CROSS_DAY: { label: "Cross-day", severity: "info", help: "Issued by the store on one day, out of the gate on another." },
  DC_PENDING: { label: "Pending", severity: "info", help: "Dispatch made; nothing issued or out yet." },
};
export const discrepancyMeta = (c: string) =>
  DISCREPANCY_META[c as DiscrepancyCode] ?? { label: c, severity: "info" as Severity, help: "" };

export const SEVERITY_TONE: Record<Severity, string> = {
  high: "bg-red-50 text-red-800 ring-red-200",
  medium: "bg-amber-50 text-amber-800 ring-amber-200",
  info: "bg-slate-100 text-slate-700 ring-slate-200",
};

export type ReconExplained = { code: string; note: string; by: string | null; at: string };

// A row is a dispatch (dispatch_id set) or an issued store pass not yet linked to any dispatch (stage 'unlinked').
export type ReconRow = {
  dispatch_id: string | null;
  dispatch_number: string | null;
  dispatch_date: string | null;
  dispatch_created_at: string | null;
  delivery_status: string | null;
  customer_name: string | null;
  order_numbers: string | null;
  dc_quantity: number | null;
  dc_packages: number | null;
  store_pass_id: string | null;
  sp_number: string | null;
  sp_status: string | null;
  sp_issued_at: string | null;
  sp_date: string | null;
  sp_dispatch_plan_no: string | null;
  sp_received_by: string | null;
  sp_dispatch_count: number | null;
  sp_quantity: number | null;
  sp_packages: number | null;
  gate_pass_id: string | null;
  gp_number: string | null;
  gp_status: string | null;
  gp_held_at: string | null;
  gate_out_at: string | null;
  out_date: string | null;
  gp_quantity: number | null;
  gp_packages: number | null;
  gp_counted_packages: number | null;
  gp_counted_quantity: number | null;
  stage: TrackingStage | "unlinked";
  cancelled_sp_number: string | null;
  cancelled_sp_reason: string | null;
  cancelled_sp_at: string | null;
  codes: string[];
  high_codes: number;
  open_high: number;
  open_medium: number;
  explained: ReconExplained[];
};

export type ReconProductRow = {
  product_id: string | null;
  product_code: string | null;
  product_name: string | null;
  dc_quantity: number;
  dc_packages: number;
  sp_quantity: number;
  sp_packages: number;
  gp_quantity: number;
  gp_packages: number;
  gp_counted_packages: number | null;
  gp_counted_quantity: number | null;
};

/** What the gate counted for a dispatch: cartons when the lines had them, else dozens; printed figures when nothing was counted (manager release). */
export const gateFigure = (r: Pick<ReconRow, "gp_counted_packages" | "gp_counted_quantity" | "gp_packages" | "gp_quantity">) => {
  if (r.gp_counted_packages !== null && r.gp_counted_packages !== undefined) return { value: Number(r.gp_counted_packages), unit: "ctn" as const, counted: true };
  if (r.gp_counted_quantity !== null && r.gp_counted_quantity !== undefined) return { value: Number(r.gp_counted_quantity), unit: "dz" as const, counted: true };
  if (r.gp_packages !== null && r.gp_packages !== undefined) return { value: Number(r.gp_packages), unit: "ctn" as const, counted: false };
  if (r.gp_quantity !== null && r.gp_quantity !== undefined) return { value: Number(r.gp_quantity), unit: "dz" as const, counted: false };
  return null;
};

export type GateStoreStatus = { mode: "off" | "warn" | "block"; missing: string[] };
