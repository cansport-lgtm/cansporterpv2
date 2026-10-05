// Shared definitions for Gate Inward (vehicles bringing goods in).
// The rules live in the database: supabase/migrations/20261005120000_gate_inward.sql.
// Every write goes through its gate_inward_* functions; the tables are read-only here.

import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

// The gate inward tables are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const giDb = supabase as any;

export type InwardKind =
  | "purchase" | "returnable_return" | "job_work_return"
  | "sales_return" | "sample" | "loading_vehicle" | "other";
export type InwardStatus =
  | "at_gate" | "grn_made" | "received" | "closed" | "loaded_out" | "rejected" | "cancelled";

export const INWARD_KINDS: {
  value: InwardKind;
  label: string;
  description: string;
  closedBy: string;
  badgeClass: string;
}[] = [
  { value: "purchase", label: "Purchase", description: "Supplier delivery against a purchase order", closedBy: "the GRN", badgeClass: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  { value: "returnable_return", label: "Returnable back", description: "Goods back from repair or loan on a returnable pass", closedBy: "Receive goods on the pass", badgeClass: "bg-sky-50 text-sky-700 ring-sky-200" },
  { value: "job_work_return", label: "Job work back", description: "Processed goods back from the job-work vendor", closedBy: "Receive goods on the pass", badgeClass: "bg-violet-50 text-violet-700 ring-violet-200" },
  { value: "sales_return", label: "Sales return", description: "A customer returning goods", closedBy: "the sales return", badgeClass: "bg-rose-50 text-rose-700 ring-rose-200" },
  { value: "sample", label: "Sample / free supply", description: "A sample or free supply, no purchase order", closedBy: "the office, with a note", badgeClass: "bg-teal-50 text-teal-700 ring-teal-200" },
  { value: "loading_vehicle", label: "Empty vehicle for loading", description: "Arrived empty to load a dispatch or scrap", closedBy: "the outward pass going out", badgeClass: "bg-amber-50 text-amber-800 ring-amber-200" },
  { value: "other", label: "Other", description: "Courier, documents, contractor material…", closedBy: "the office, with a note", badgeClass: "bg-stone-100 text-stone-700 ring-stone-200" },
];

type RoleList = { role: string }[];
/** Can make entries and tap "Vehicle left" (the gate). */
export const canInwardGate = (roles: RoleList) =>
  roles.some((r) => ["super_admin", "gate_pass_manager", "gate_security"].includes(r.role));
/** Can run the register: reject / cancel / close, link the GRN or receipt (the office). */
export const canInwardOffice = (roles: RoleList) =>
  roles.some((r) => ["super_admin", "admin", "purchase_manager", "purchase_officer", "gate_pass_manager"].includes(r.role));
/** Can open the Purchase pages (to make the GRN from an entry). */
export const canInwardPurchasePages = (roles: RoleList) =>
  roles.some((r) => ["super_admin", "admin", "purchase_manager", "purchase_officer"].includes(r.role));

export const kindMeta = (k: string) => INWARD_KINDS.find((x) => x.value === k) ?? INWARD_KINDS[INWARD_KINDS.length - 1];

export const INWARD_STATUS: Record<string, { label: string; variant: "warning" | "success" | "destructive" | "secondary" | "info" | "soft" }> = {
  at_gate: { label: "At gate", variant: "warning" },
  grn_made: { label: "Received (GRN)", variant: "success" },
  received: { label: "Received", variant: "success" },
  closed: { label: "Closed", variant: "secondary" },
  loaded_out: { label: "Loaded & out", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export const inwardStatusMeta = (s: string) => INWARD_STATUS[s] ?? { label: s, variant: "secondary" as const };

export type InwardSettings = {
  require_for_grn: boolean;
  require_for_categories: string[];
  purchase_categories: string[];
  enabled_kinds: InwardKind[];
  stale_days: number;
};

export const DEFAULT_SETTINGS: InwardSettings = {
  require_for_grn: false,
  require_for_categories: ["raw_material"],
  purchase_categories: ["raw_material"],
  enabled_kinds: ["purchase", "returnable_return", "job_work_return"],
  stale_days: 3,
};

/** One row of v_gate_inward_register. */
export type InwardEntry = {
  id: string;
  entry_number: string;
  entry_kind: InwardKind;
  status: InwardStatus;
  entry_date: string;
  in_at: string;
  supplier_id: string | null;
  customer_id: string | null;
  party_name: string;
  purchase_order_id: string | null;
  gate_pass_id: string | null;
  dispatch_id: string | null;
  vehicle_number: string;
  driver_name: string | null;
  driver_contact: string | null;
  transporter_name: string | null;
  challan_number: string | null;
  challan_date: string | null;
  packages_count: number | null;
  gross_weight_kg: number | null;
  challan_photo_path: string | null;
  vehicle_photo_path: string | null;
  remarks: string | null;
  created_by: string;
  created_at: string;
  vehicle_out_at: string | null;
  vehicle_out_by: string | null;
  grn_id: string | null;
  gate_pass_receipt_id: string | null;
  sales_return_id: string | null;
  out_gate_pass_id: string | null;
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  // from the view
  supplier_name: string | null;
  supplier_code: string | null;
  po_number: string | null;
  po_category: string | null;
  po_status: string | null;
  pass_number: string | null;
  pass_type: string | null;
  expected_return_date: string | null;
  grn_number: string | null;
  grn_date: string | null;
  receipt_number: string | null;
  receipt_date: string | null;
  created_by_name: string | null;
  vehicle_out_by_name: string | null;
  age_days: number;
  is_stale: boolean;
};

export type InwardEvent = {
  id: string;
  event: string;
  message: string | null;
  created_at: string;
  actor: { full_name: string | null } | null;
};

export const INWARD_EVENT_LABEL: Record<string, string> = {
  created: "Recorded at the gate",
  edited: "Edited",
  vehicle_out: "Vehicle left",
  grn_made: "GRN made",
  grn_removed: "GRN deleted",
  received: "Goods received",
  closed: "Closed",
  loaded_out: "Loaded and out",
  rejected: "Rejected",
  cancelled: "Cancelled",
  rescan_attempt: "Opened again at the gate",
};

/** The record this entry arrives against, for lists and slips. */
export const inwardReference = (e: Pick<InwardEntry, "entry_kind" | "po_number" | "pass_number">) =>
  e.entry_kind === "purchase" ? e.po_number ?? "" : e.pass_number ?? "";

/** What closed it, for lists. */
export const inwardClosingRef = (e: Pick<InwardEntry, "status" | "grn_number" | "receipt_number">) =>
  e.status === "grn_made" ? e.grn_number ?? "" : e.status === "received" ? e.receipt_number ?? "" : "";

export const isInwardNumber = (raw: string) => /^GIN-?\d+$/i.test(raw.trim()) || /[?&]gin=/i.test(raw);

/** "12", "gin12", "GIN-000012" or a scanned URL → "GIN-000012". */
export function normalizeInwardNumber(raw: string): string {
  let text = raw.trim();
  try {
    const url = new URL(text);
    text = url.searchParams.get("gin") ?? url.pathname.split("/").pop() ?? text;
  } catch {
    /* not a URL */
  }
  const digits = text.toUpperCase().replace(/^GIN-?/, "").replace(/\D/g, "");
  return digits ? `GIN-${digits.padStart(6, "0")}` : text.toUpperCase();
}

export const fmtInAt = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");

/** Print the inward gate slip. Nothing commercial and no quantities are on it. `qrSvg` is the QR's outerHTML. */
export function printInwardSlip(e: InwardEntry, qrSvg: string) {
  const kind = kindMeta(e.entry_kind);
  const ref = inwardReference(e);
  const body = `
  <style>
    .gi .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; margin-top: 12px; }
    .gi .sign { display: flex; gap: 16px; margin-top: 56px; }
    .gi .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; text-align: center; }
    .gi .box { border: 1px solid #bbb; padding: 10px; margin-top: 14px; font-size: 12px; }
  </style>
  <div class="wrap gi">
    <div class="head">
      <div>
        <h1>Cansport Global Industries</h1>
        <div class="bold" style="margin-top:8px; letter-spacing:.08em; font-size:15px">INWARD GATE ENTRY</div>
        ${e.status === "rejected" || e.status === "cancelled" ? `<div class="bold" style="color:#b42318">${esc(inwardStatusMeta(e.status).label.toUpperCase())}</div>` : ""}
      </div>
      <div style="text-align:center">${qrSvg}<div class="xs muted">Scan at gate / store</div></div>
    </div>
    <div class="facts">
      <div><span class="muted">GIN no.</span> <b style="font-size:15px">${esc(e.entry_number)}</b></div>
      <div><span class="muted">In at</span> <b>${esc(fmtInAt(e.in_at))}</b></div>
      <div><span class="muted">Type</span> <b>${esc(kind.label)}</b></div>
      <div><span class="muted">${e.entry_kind === "purchase" ? "Purchase order" : e.gate_pass_id ? "Gate pass" : "Reference"}</span> <b>${esc(ref || "—")}</b></div>
      <div style="grid-column: span 2"><span class="muted">From</span> <b>${esc(e.party_name)}</b></div>
      <div><span class="muted">Vehicle</span> <b style="font-size:14px">${esc(e.vehicle_number)}</b></div>
      <div><span class="muted">Driver</span> <b>${esc([e.driver_name, e.driver_contact].filter(Boolean).join(" · ") || "—")}</b></div>
      <div><span class="muted">Transporter</span> <b>${esc(e.transporter_name || "—")}</b></div>
      <div><span class="muted">Challan / bilty</span> <b>${esc(e.challan_number || "—")}${e.challan_date ? ` (${esc(format(new Date(e.challan_date), "dd MMM yyyy"))})` : ""}</b></div>
      <div><span class="muted">Packages</span> <b>${e.packages_count ?? "—"}</b></div>
      <div><span class="muted">Gross weight</span> <b>${e.gross_weight_kg != null ? `${esc(e.gross_weight_kg)} kg` : "—"}</b></div>
      ${e.vehicle_out_at ? `<div style="grid-column: span 2"><span class="muted">Vehicle left</span> <b>${esc(fmtInAt(e.vehicle_out_at))}</b></div>` : ""}
      ${e.grn_number ? `<div style="grid-column: span 2"><span class="muted">GRN</span> <b>${esc(e.grn_number)}</b></div>` : ""}
      ${e.receipt_number ? `<div style="grid-column: span 2"><span class="muted">Receipt</span> <b>${esc(e.receipt_number)}</b></div>` : ""}
    </div>
    <div class="box">
      <b>Store use.</b> Quantities are counted and recorded by the store on the ${esc(kind.closedBy)}, not at the gate.
      ${e.remarks ? `<div style="margin-top:6px">Remarks: ${esc(e.remarks)}</div>` : ""}
    </div>
    <div class="sign">
      <div>Security<br><b>${esc(e.created_by_name ?? "")}</b></div>
      <div>Driver<br>&nbsp;</div>
      <div>Store / receiver<br>&nbsp;</div>
    </div>
  </div>`;
  printDocument(e.entry_number, body);
}
