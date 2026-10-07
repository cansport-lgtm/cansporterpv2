// Shared definitions for Purchase Requests (PRQ-…): any department asks
// Purchase to buy items; department head → Purchase → (above the value limit)
// super admin. The rules live in the database: see
// supabase/migrations/20261016130000_purchase_requests.sql.
// Every write goes through its purchase_request_* functions; the tables are read-only here.

import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";
import { purchaseCategoryLabel, type PurchaseCategory } from "@/lib/purchase/categories";

// The purchase request tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const prDb = supabase as any;

export type PurchaseRequestStatus =
  | "draft" | "pending_hod" | "pending_purchase" | "pending_final" | "approved"
  | "partially_ordered" | "ordered" | "rejected" | "cancelled";

type BadgeVariant = "warning" | "success" | "destructive" | "secondary" | "info" | "soft";

export const PR_STATUS_META: Record<PurchaseRequestStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending_hod: { label: "With department head", variant: "warning" },
  pending_purchase: { label: "With Purchase", variant: "warning" },
  pending_final: { label: "Final approval", variant: "warning" },
  approved: { label: "Approved", variant: "success" },
  partially_ordered: { label: "Partly ordered", variant: "info" },
  ordered: { label: "Ordered", variant: "info" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};
export const prStatusMeta = (s: string) =>
  PR_STATUS_META[s as PurchaseRequestStatus] ?? { label: s, variant: "secondary" as const };

export const PENDING_STATUSES: PurchaseRequestStatus[] = ["pending_hod", "pending_purchase", "pending_final"];

export type PurchaseRequestItem = {
  id: string;
  line_no: number;
  item_id: string;
  requested_qty: number;
  approved_qty: number | null;
  ordered_qty: number;
  est_rate: number;
  remarks: string | null;
  items?: { code: string; name: string; units_of_measure?: { symbol: string } | null } | null;
};

type UserRef = { full_name: string | null } | null;

export type PurchaseRequest = {
  id: string;
  pr_number: string;
  category: PurchaseCategory;
  department_id: string;
  status: PurchaseRequestStatus;
  priority: "normal" | "urgent";
  request_date: string;
  required_by: string | null;
  purpose: string;
  machine_id: string | null;
  is_breakdown: boolean;
  job_order_ref: string | null;
  estimated_total: number;
  needs_final_approval: boolean;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  hod_at: string | null;
  hod_remarks: string | null;
  purchase_at: string | null;
  purchase_remarks: string | null;
  final_at: string | null;
  final_remarks: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  department?: { name: string } | null;
  machine?: { code: string; name: string } | null;
  requester?: UserRef;
  hod?: UserRef;
  purchaser?: UserRef;
  finaliser?: UserRef;
  purchase_request_items?: PurchaseRequestItem[];
};

export const PR_SELECT =
  "*," +
  "department:production_departments!purchase_requests_department_id_fkey(name)," +
  "machine:machines!purchase_requests_machine_id_fkey(code, name)," +
  "requester:app_users!purchase_requests_created_by_fkey(full_name)," +
  "hod:app_users!purchase_requests_hod_by_fkey(full_name)," +
  "purchaser:app_users!purchase_requests_purchase_by_fkey(full_name)," +
  "finaliser:app_users!purchase_requests_final_by_fkey(full_name)," +
  "purchase_request_items(*, items(code, name, units_of_measure(symbol)))";

export const PR_LIST_SELECT =
  "id, pr_number, category, department_id, status, priority, request_date, required_by, purpose, " +
  "is_breakdown, estimated_total, created_by, created_at, submitted_at, reject_reason, cancel_reason," +
  "department:production_departments!purchase_requests_department_id_fkey(name)," +
  "requester:app_users!purchase_requests_created_by_fkey(full_name)," +
  "purchase_request_items(id)";

export const sortedItems = (r: PurchaseRequest) =>
  [...(r.purchase_request_items ?? [])].sort((a, b) => a.line_no - b.line_no);

/** The quantity that counts now: approved once an approver has set it, else requested. */
export const effectiveQty = (i: Pick<PurchaseRequestItem, "approved_qty" | "requested_qty">) =>
  Number(i.approved_qty ?? i.requested_qty);

export const fmtQty = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const fmtMoney = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Today in the factory's time zone as yyyy-MM-dd. */
export const todayPk = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

/** Supabase/PostgREST error → readable message (the purchase_request_* functions raise plain sentences). */
export const errorMessage = (e: unknown) =>
  (e as { message?: string })?.message ?? "Something went wrong.";

export const EVENT_LABEL: Record<string, string> = {
  created: "Draft created",
  edited: "Edited",
  submitted: "Submitted",
  hod_approved: "Approved by department head",
  hod_rejected: "Rejected by department head",
  purchase_approved: "Approved by Purchase",
  purchase_rejected: "Rejected by Purchase",
  final_approved: "Final approval given",
  final_rejected: "Rejected at final approval",
  cancelled: "Cancelled",
};

const fmtDate = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy") : "");
const fmtDateTime = (s: string | null) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "");

/** Print the purchase request slip. Rates and values only when `showPrices`. */
export function printPurchaseRequest(r: PurchaseRequest, showPrices: boolean) {
  const items = sortedItems(r);
  const rows = items
    .map((i, n) => `<tr>
        <td>${n + 1}</td>
        <td>${esc(i.items?.code ?? "")}</td>
        <td>${esc(i.items?.name ?? "")}</td>
        <td>${esc(i.items?.units_of_measure?.symbol ?? "")}</td>
        <td class="right">${esc(fmtQty(i.requested_qty))}</td>
        <td class="right">${i.approved_qty == null ? "" : esc(fmtQty(i.approved_qty))}</td>
        ${showPrices ? `<td class="right">${esc(fmtMoney(i.est_rate))}</td><td class="right">${esc(fmtMoney(effectiveQty(i) * Number(i.est_rate)))}</td>` : ""}
        <td>${esc(i.remarks ?? "")}</td>
      </tr>`)
    .join("");
  const stamp = r.status === "rejected" ? "REJECTED" : r.status === "cancelled" ? "CANCELLED"
    : r.status === "draft" ? "DRAFT — NOT SUBMITTED" : PENDING_STATUSES.includes(r.status) ? "NOT YET APPROVED" : "";
  const body = `
  <style>
    .pr table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .pr th, .pr td { border: 1px solid #bbb; padding: 6px 8px; font-size: 12px; text-align: left; vertical-align: top; }
    .pr th { background: #f1f3f7; }
    .pr .right { text-align: right; }
    .pr .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 12px; }
    .pr .sign { display: flex; gap: 16px; margin-top: 56px; }
    .pr .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 11px; text-align: center; }
  </style>
  <div class="wrap pr">
    <div class="head">
      <div>
        <h1>Cansport Global Industries</h1>
        <div class="muted xs">Purchase Department</div>
        <div class="bold" style="margin-top:8px; letter-spacing:.08em; font-size:15px">PURCHASE REQUEST</div>
        ${stamp ? `<div class="bold" style="color:#b42318">${stamp}</div>` : ""}
      </div>
      <div style="text-align:right">
        <div class="bold" style="font-size:16px">${esc(r.pr_number)}</div>
        ${r.priority === "urgent" ? `<div class="bold" style="color:#b42318">URGENT${r.is_breakdown ? " — BREAKDOWN" : ""}</div>` : ""}
      </div>
    </div>
    <div class="facts">
      <div><span class="muted">Category</span> <b>${esc(purchaseCategoryLabel(r.category))}</b></div>
      <div><span class="muted">Department</span> <b>${esc(r.department?.name ?? "")}</b></div>
      <div><span class="muted">Request date</span> <b>${esc(fmtDate(r.request_date))}</b></div>
      <div><span class="muted">Required by</span> <b>${esc(fmtDate(r.required_by) || "—")}</b></div>
      <div><span class="muted">Requested by</span> <b>${esc(r.requester?.full_name ?? "")}</b></div>
      ${r.machine ? `<div><span class="muted">Machine</span> <b>${esc(r.machine.code)} ${esc(r.machine.name)}</b></div>` : ""}
      ${r.job_order_ref ? `<div><span class="muted">Job order</span> <b>${esc(r.job_order_ref)}</b></div>` : ""}
    </div>
    <p style="font-size:12px"><span class="muted">Purpose</span> ${esc(r.purpose)}</p>
    <table>
      <thead><tr><th>#</th><th>Code</th><th>Item</th><th>Unit</th><th class="right">Requested</th><th class="right">Approved</th>
        ${showPrices ? `<th class="right">Est. rate</th><th class="right">Est. value</th>` : ""}<th>Remark</th></tr></thead>
      <tbody>${rows}</tbody>
      ${showPrices ? `<tfoot><tr><td colspan="7" class="right bold">Estimated value</td><td class="right bold">${esc(fmtMoney(r.estimated_total))}</td><td></td></tr></tfoot>` : ""}
    </table>
    <div class="sign">
      <div>Requested by<br><b>${esc(r.requester?.full_name ?? "")}</b><br>${esc(fmtDateTime(r.submitted_at))}</div>
      <div>Department head<br><b>${esc(r.hod?.full_name ?? "")}</b><br>${esc(fmtDateTime(r.hod_at))}</div>
      <div>Purchase<br><b>${esc(r.purchaser?.full_name ?? "")}</b><br>${esc(fmtDateTime(r.purchase_at))}</div>
      ${r.needs_final_approval ? `<div>Final approval<br><b>${esc(r.finaliser?.full_name ?? "")}</b><br>${esc(fmtDateTime(r.final_at))}</div>` : ""}
    </div>
  </div>`;
  printDocument(r.pr_number, body);
}
