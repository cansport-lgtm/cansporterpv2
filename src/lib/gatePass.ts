// Shared definitions for the Gate Pass (outward) module.
// The rules live in the database: see supabase/migrations/20260928120100_gate_pass.sql
// (Phase 1) and 20260929120000_gate_pass_phase2_3.sql (returnable, job work, scrap, backfill).
// Every write goes through its gate_pass_* functions; the tables are read-only here.

import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

// The gate pass tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const gpDb = supabase as any;

export type GatePassType = "sales" | "sample" | "returnable" | "job_work" | "supplier_return" | "scrap";
export type GatePassStatus =
  | "draft" | "pending_approval" | "approved" | "held" | "out"
  | "partially_returned" | "returned" | "closed" | "rejected" | "cancelled";

export const PASS_TYPES: {
  value: GatePassType;
  label: string;
  description: string;
  approval: string;
  available: boolean;
  badgeClass: string;
}[] = [
  { value: "sales", label: "Sales", description: "Dispatches of approved sales orders, one vehicle", approval: "Approved automatically", available: true, badgeClass: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  { value: "sample", label: "Sample", description: "Free samples to customers or distributors", approval: "Needs sample manager approval", available: true, badgeClass: "bg-teal-50 text-teal-700 ring-teal-200" },
  { value: "supplier_return", label: "Supplier return", description: "Rejected material back on a purchase return", approval: "Approved automatically", available: true, badgeClass: "bg-orange-50 text-orange-700 ring-orange-200" },
  { value: "returnable", label: "Returnable", description: "Repair or loan, due back by a date", approval: "Needs returnable manager approval", available: true, badgeClass: "bg-sky-50 text-sky-700 ring-sky-200" },
  { value: "job_work", label: "Job work", description: "Sent for processing, comes back processed", approval: "Needs job work manager approval", available: true, badgeClass: "bg-violet-50 text-violet-700 ring-violet-200" },
  { value: "scrap", label: "Scrap", description: "Scrap sold, weighed at the gate", approval: "Needs scrap manager approval", available: true, badgeClass: "bg-stone-100 text-stone-700 ring-stone-200" },
];

// Who approves each pass type: its own manager role (or super admin). The general
// gate_pass_manager does not approve these; sales / supplier returns are automatic.
export const TYPE_APPROVER_ROLE: Partial<Record<GatePassType, string>> = {
  sample: "gate_pass_sample_manager",
  returnable: "gate_pass_returnable_manager",
  job_work: "gate_pass_jobwork_manager",
  scrap: "gate_pass_scrap_manager",
};

// Types whose maker may not approve or reject their own pass (super admin excepted).
export const SELF_REVIEW_BLOCKED: GatePassType[] = ["sample"];

export const isSuperAdmin = (roles: { role: string }[]) => roles.some((r) => r.role === "super_admin");

export const canApproveGatePassType = (roles: { role: string }[], type: string) =>
  roles.some((r) => r.role === "super_admin" || r.role === TYPE_APPROVER_ROLE[type as GatePassType]);

// Can this user approve / reject this particular pass? Same as the type check, except
// the maker of a sample pass must leave it to another sample manager.
export const canReviewGatePass = (
  roles: { role: string }[],
  pass: { pass_type: string; created_by: string | null },
  userId: string | null | undefined,
) =>
  canApproveGatePassType(roles, pass.pass_type) &&
  !(SELF_REVIEW_BLOCKED.includes(pass.pass_type as GatePassType) && !isSuperAdmin(roles) && !!userId && pass.created_by === userId);

// True when the only reason this user cannot review the pass is that they raised it.
export const isOwnPassBlocked = (
  roles: { role: string }[],
  pass: { pass_type: string; created_by: string | null },
  userId: string | null | undefined,
) => canApproveGatePassType(roles, pass.pass_type) && !canReviewGatePass(roles, pass, userId);

// Types this user can approve (empty for everyone but type managers and super admin).
export const approvableGatePassTypes = (roles: { role: string }[]) =>
  PASS_TYPES.filter((t) => TYPE_APPROVER_ROLE[t.value] && canApproveGatePassType(roles, t.value)).map((t) => t.value);

export const passTypeMeta = (t: string) => PASS_TYPES.find((p) => p.value === t) ?? PASS_TYPES[0];

export const STATUS_META: Record<string, { label: string; variant: "warning" | "success" | "destructive" | "secondary" | "info" | "soft" }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending_approval: { label: "Pending approval", variant: "warning" },
  approved: { label: "Approved", variant: "info" },
  held: { label: "Held at gate", variant: "destructive" },
  out: { label: "Out", variant: "success" },
  partially_returned: { label: "Partly returned", variant: "soft" },
  returned: { label: "Returned", variant: "success" },
  closed: { label: "Closed", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

// A pass in one of these states must never let a vehicle out again: opening it
// on Gate Check sounds the alarm and logs a re-scan attempt.
export const REUSE_ALARM_STATUSES = ["out", "partially_returned", "returned", "closed", "cancelled", "rejected"];

export const statusMeta = (s: string) => STATUS_META[s] ?? { label: s, variant: "secondary" as const };

export type GatePassItem = {
  id: string;
  line_no: number;
  product_id: string | null;
  dispatch_id: string | null;
  dispatch_item_id: string | null;
  description: string;
  uom: string;
  quantity: number;
  packages: number | null;
  count_basis: "quantity" | "packages";
  original_quantity: number | null;
  original_packages: number | null;
  counted: number | null;
  counted_at: string | null;
  remarks: string | null;
  item_id: string | null;
  machine_id: string | null;
  fixed_asset_id: string | null;
  spare_part_id: string | null;
  scrap_category_id: string | null;
  estimated_quantity: number | null;
  expected_output_product_id: string | null;
  expected_output_item_id: string | null;
  expected_output_description: string | null;
  wastage_quantity: number;
};

export type GatePass = {
  id: string;
  pass_number: string;
  pass_type: GatePassType;
  status: GatePassStatus;
  pass_date: string;
  party_kind: string | null;
  party_id: string | null;
  party_name: string;
  vehicle_number: string | null;
  driver_name: string | null;
  driver_contact: string | null;
  transporter_name: string | null;
  purchase_return_id: string | null;
  remarks: string | null;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  approval_remarks: string | null;
  gate_vehicle_number: string | null;
  held_at: string | null;
  hold_note: string | null;
  released_at: string | null;
  release_reason: string | null;
  gate_out_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  expected_return_date: string | null;
  process_name: string | null;
  weighbridge_photo_path: string | null;
  is_backfill: boolean;
  book_id: string | null;
  book_serial: number | null;
  paper_datetime: string | null;
  paper_photo_path: string | null;
  backfill_reason: string | null;
  closed_at: string | null;
  close_reason: string | null;
  gate_pass_books?: { book_number: string } | null;
  creator?: { full_name: string | null } | null;
  approver?: { full_name: string | null } | null;
  holder?: { full_name: string | null } | null;
  releaser?: { full_name: string | null } | null;
  gate_out_user?: { full_name: string | null } | null;
  gate_pass_items?: GatePassItem[];
  gate_pass_dispatches?: {
    dispatch_id: string;
    sales_dispatches: { dispatch_number: string; dispatch_date: string; delivery_status: string } | null;
  }[];
  purchase_returns?: { return_number: string | null; status: string } | null;
};

export const PASS_SELECT =
  "*," +
  "creator:app_users!gate_passes_created_by_fkey(full_name)," +
  "approver:app_users!gate_passes_approved_by_fkey(full_name)," +
  "holder:app_users!gate_passes_held_by_fkey(full_name)," +
  "releaser:app_users!gate_passes_released_by_fkey(full_name)," +
  "gate_out_user:app_users!gate_passes_gate_out_by_fkey(full_name)," +
  "gate_pass_items(*)," +
  "gate_pass_dispatches(dispatch_id, sales_dispatches(dispatch_number, dispatch_date, delivery_status))," +
  "purchase_returns(return_number, status)," +
  "gate_pass_books(book_number)";

export const fmtQty = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

/** What the guard counts on a line: cartons when it has them, else the quantity. */
export const expectedCount = (i: Pick<GatePassItem, "count_basis" | "packages" | "quantity">) =>
  i.count_basis === "packages" ? Number(i.packages || 0) : Number(i.quantity);

export const countUnit = (i: Pick<GatePassItem, "count_basis" | "uom">) =>
  i.count_basis === "packages" ? "ctn" : i.uom;

export const sortedItems = (p: GatePass) =>
  [...(p.gate_pass_items ?? [])].sort((a, b) => a.line_no - b.line_no);

/** "131", "gp131", "GP-000131" or a scanned URL → "GP-000131". */
export function normalizePassNumber(raw: string): string {
  let text = raw.trim();
  try {
    const url = new URL(text);
    text = url.searchParams.get("gp") ?? url.pathname.split("/").pop() ?? text;
  } catch {
    /* not a URL */
  }
  const digits = text.toUpperCase().replace(/^GP-?/, "").replace(/\D/g, "");
  return digits ? `GP-${digits.padStart(6, "0")}` : text.toUpperCase();
}

export const PHOTO_BUCKET = "gate-pass-photos";

/** Upload a photo (weighbridge slip, paper pass) and return its storage path. */
export async function uploadGatePassPhoto(file: File, folder: string): Promise<string> {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${folder}/${format(new Date(), "yyyyMMdd")}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type || undefined });
  if (error) throw error;
  return path;
}

export const photoUrl = (path: string | null | undefined) =>
  path ? supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl : null;

/** Today in the factory's time zone as yyyy-MM-dd (the database dates things in Asia/Karachi). */
export const todayPk = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

/** Supabase/PostgREST error → readable message (the gate_pass_* functions raise plain sentences). */
export const errorMessage = (e: unknown) =>
  (e as { message?: string })?.message ?? "Something went wrong.";

const fmtDateTime = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "");

/** Print the A5-style outward pass. No prices are ever on it. `qrSvg` is the QR's outerHTML. */
export function printGatePass(p: GatePass, qrSvg: string) {
  const items = sortedItems(p).filter((i) => Number(i.quantity) > 0);
  const hasPackages = items.some((i) => i.packages !== null);
  const dispatches = (p.gate_pass_dispatches ?? [])
    .map((d) => d.sales_dispatches?.dispatch_number)
    .filter(Boolean)
    .join(", ");
  const approval = p.approved_by
    ? p.approver?.full_name ?? "Manager"
    : p.approved_at
      ? "Auto"
      : "";
  const rows = items
    .map(
      (i, n) => `<tr>
        <td>${n + 1}</td>
        <td>${esc(i.description)}${i.expected_output_description ? `<div class="xs muted">Comes back as: ${esc(i.expected_output_description)}</div>` : ""}</td>
        <td class="right">${p.pass_type === "scrap" && p.status !== "out" ? "approx. " : ""}${esc(fmtQty(i.quantity))} ${esc(i.uom)}</td>
        ${hasPackages ? `<td class="right">${i.packages ?? ""}</td>` : ""}
        <td></td>
      </tr>`,
    )
    .join("");
  const body = `
  <style>
    .gp table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .gp th, .gp td { border: 1px solid #bbb; padding: 6px 8px; font-size: 12px; text-align: left; }
    .gp th { background: #f1f3f7; }
    .gp .right { text-align: right; }
    .gp .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; }
    .gp .sign { display: flex; gap: 16px; margin-top: 56px; }
    .gp .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; text-align: center; }
  </style>
  <div class="wrap gp">
    <div class="head">
      <div>
        <h1>Cansport Global Industries</h1>
        <div class="bold" style="margin-top:8px; letter-spacing:.08em; font-size:15px">OUTWARD GATE PASS</div>
        ${p.status === "draft" || p.status === "pending_approval" ? `<div class="bold" style="color:#b42318">NOT APPROVED — NOT VALID FOR EXIT</div>` : ""}
      </div>
      <div style="text-align:center">${qrSvg}<div class="xs muted">Scan at gate</div></div>
    </div>
    <div class="facts">
      <div><span class="muted">GP no.</span> <b style="font-size:15px">${esc(p.pass_number)}</b></div>
      <div><span class="muted">Date</span> <b>${esc(format(new Date(p.pass_date), "dd MMM yyyy"))}</b></div>
      <div><span class="muted">Type</span> <b>${esc(passTypeMeta(p.pass_type).label)}</b></div>
      <div><span class="muted">Approval</span> <b>${esc(approval || statusMeta(p.status).label)}</b></div>
      <div><span class="muted">Vehicle</span> <b>${esc(p.vehicle_number || "Hand carry")}</b></div>
      <div><span class="muted">Driver</span> <b>${esc([p.driver_name, p.driver_contact].filter(Boolean).join(" · "))}</b></div>
      <div style="grid-column: span 2"><span class="muted">Party</span> <b>${esc(p.party_name)}</b></div>
      ${dispatches ? `<div style="grid-column: span 2"><span class="muted">Dispatches</span> <b>${esc(dispatches)}</b></div>` : ""}
      ${p.purchase_returns?.return_number ? `<div style="grid-column: span 2"><span class="muted">Purchase return</span> <b>${esc(p.purchase_returns.return_number)}</b></div>` : ""}
      ${p.process_name ? `<div><span class="muted">Process</span> <b>${esc(p.process_name)}</b></div>` : ""}
      ${p.expected_return_date ? `<div><span class="muted">Due back</span> <b>${esc(format(new Date(p.expected_return_date), "dd MMM yyyy"))}</b></div>` : ""}
      ${p.gate_out_at ? `<div style="grid-column: span 2"><span class="muted">Out at gate</span> <b>${esc(fmtDateTime(p.gate_out_at))}</b></div>` : ""}
      ${p.is_backfill ? `<div style="grid-column: span 2"><b>MANUAL BACKFILL</b> of paper pass ${esc(p.gate_pass_books?.book_number ?? "")} / ${esc(p.book_serial ?? "")}</div>` : ""}
    </div>
    <table>
      <thead><tr><th>#</th><th>Item</th><th class="right">Qty</th>${hasPackages ? `<th class="right">Cartons</th>` : ""}<th>Guard ✓</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${p.remarks ? `<p style="font-size:12px">Remarks: ${esc(p.remarks)}</p>` : ""}
    <div class="sign">
      <div>Prepared by<br><b>${esc(p.creator?.full_name ?? "")}</b></div>
      <div>Approved by<br><b>${esc(approval)}</b></div>
      <div>Security<br>&nbsp;</div>
      <div>Driver / receiver<br>&nbsp;</div>
    </div>
    <p class="xs muted" style="text-align:center; margin-top:12px">Goods may leave only after the gate scan shows "Out".</p>
  </div>`;
  printDocument(p.pass_number, body);
}

// Gate pass no. / gate-out time for dispatch lists (read-only extra columns).
export type DispatchGatePass = {
  dispatch_id: string;
  gate_pass_id: string;
  pass_number: string;
  status: string;
  gate_out_at: string | null;
};

const CHUNK = 150;

/** The live gate pass (if any) of each dispatch id, keyed by dispatch id. */
export function useDispatchGatePasses(dispatchIds: string[]) {
  const ids = [...new Set(dispatchIds)].sort();
  const { data } = useQuery<Map<string, DispatchGatePass>>({
    queryKey: ["dispatch-gate-pass", ids],
    enabled: ids.length > 0,
    queryFn: async () => {
      const map = new Map<string, DispatchGatePass>();
      for (let i = 0; i < ids.length; i += CHUNK) {
        const { data: rows, error } = await gpDb
          .from("v_dispatch_gate_pass")
          .select("dispatch_id, gate_pass_id, pass_number, status, gate_out_at")
          .in("dispatch_id", ids.slice(i, i + CHUNK));
        // The view is missing until the gate pass migration is applied — show blanks, never break the page.
        if (error) return map;
        (rows as DispatchGatePass[]).forEach((r) => map.set(r.dispatch_id, r));
      }
      return map;
    },
  });
  return data ?? new Map<string, DispatchGatePass>();
}
