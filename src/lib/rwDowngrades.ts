// Downgrade forms (DG-…), Rejections & Wastages module.
//
// A downgrade records the decision to use an item at a lower grade (e.g. T → VM)
// with the reason and the cost difference. It never moves stock, posts to the
// ball ledger or changes production; an APPROVED form's loss is reported in
// R&W Analytics, dated by its approval day (approved_on). Only a super admin
// approves or rejects; a rejected form is closed and a new one must be raised.
//
// All writes go through SECURITY DEFINER functions that check roles in the
// database — see supabase/migrations/20261022120000_rw_downgrades.sql.

import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";
import cansportLogo from "@/assets/cansport-logo.png";

// The table is not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dgDb = supabase as any;

export const DOWNGRADES_KEY = "rw-downgrades";

export type DowngradeStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface Downgrade {
  id: string;
  downgrade_no: string;
  request_date: string;
  requester_name: string;
  department_id: string | null;
  department_name: string | null;
  item_grade_id: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  original_grade_id: string | null;
  original_grade_name: string;
  proposed_grade_id: string | null;
  proposed_grade_name: string;
  issue: string;
  why_original_unusable: string;
  reason_for_converting: string;
  original_rate: number;
  downgraded_rate: number;
  cost_loss: number;
  status: DowngradeStatus;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  approved_on: string | null;
  requested_by: string | null;
  created_at: string;
}

export const STATUS_LABEL: Record<DowngradeStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const STATUS_CLASS: Record<DowngradeStatus, string> = {
  pending: "bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300",
  approved: "bg-green-600/10 text-green-700 border-green-600/30 dark:text-green-300",
  rejected: "bg-red-600/10 text-red-700 border-red-600/30 dark:text-red-300",
  cancelled: "bg-slate-500/10 text-slate-600 border-slate-500/30 dark:text-slate-300",
};

export const rs = (n: number | null | undefined) =>
  `Rs. ${Math.round(Number(n || 0)).toLocaleString()}`;

export const fmtDate = (d: string | null | undefined) => (d ? format(new Date(d), "dd MMM yyyy") : "—");
export const fmtStamp = (d: string | null | undefined) => (d ? format(new Date(d), "dd MMM yyyy HH:mm") : "—");

export interface SubmitDowngradeInput {
  requesterName: string;
  departmentId: string;
  itemGradeId: string | null;
  itemName: string;
  quantity: number;
  unit: string;
  originalGradeId: string;
  proposedGradeId: string;
  issue: string;
  whyOriginalUnusable: string;
  reasonForConverting: string;
  originalRate: number;
  downgradedRate: number;
}

/** Raise a downgrade form. Returns the new form number. */
export const submitDowngrade = async (i: SubmitDowngradeInput): Promise<string> => {
  const { data, error } = await dgDb.rpc("rw_downgrade_submit", {
    p_requester_name: i.requesterName,
    p_department_id: i.departmentId,
    p_item_grade_id: i.itemGradeId,
    p_item_name: i.itemName,
    p_quantity: i.quantity,
    p_unit: i.unit,
    p_original_grade_id: i.originalGradeId,
    p_proposed_grade_id: i.proposedGradeId,
    p_issue: i.issue,
    p_why_original_unusable: i.whyOriginalUnusable,
    p_reason_for_converting: i.reasonForConverting,
    p_original_rate: i.originalRate,
    p_downgraded_rate: i.downgradedRate,
  });
  if (error) throw error;
  return (data as { downgrade_no: string }).downgrade_no;
};

/** Super admin: approve, or reject with a remark. */
export const reviewDowngrade = async (id: string, approve: boolean, notes: string): Promise<void> => {
  const { error } = await dgDb.rpc("rw_downgrade_review", { p_id: id, p_approve: approve, p_notes: notes });
  if (error) throw error;
};

/** Requester withdraws a form still waiting for approval. */
export const cancelDowngrade = async (id: string): Promise<void> => {
  const { error } = await dgDb.rpc("rw_downgrade_cancel", { p_id: id });
  if (error) throw error;
};

export interface GradeRateRow {
  grade_id: string | null;
  standard_cost: number;
  is_active: boolean;
  updated_at: string;
}

/**
 * Rate for a grade from Cheap Ball Rates: the standard cost of the grade's most
 * recently updated active row. Undefined when the grade has no rate yet.
 */
export const rateForGrade = (rates: GradeRateRow[], gradeId: string): number | undefined => {
  const hit = rates
    .filter((r) => r.is_active && r.grade_id === gradeId && Number(r.standard_cost) > 0)
    .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))[0];
  return hit ? Number(hit.standard_cost) : undefined;
};

const logoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

const FORM_CSS = `
  .box { border: 1px solid #333; margin-bottom: 12px; page-break-inside: avoid; }
  .box .bh { background: #eee; border-bottom: 1px solid #333; padding: 5px 8px; font-weight: 700;
             text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
  .box table td { border: 1px solid #bbb; padding: 6px 8px; }
  .box td.k { background: #fafafa; width: 22%; font-weight: 700; }
  .txt { padding: 8px; border-bottom: 1px solid #ccc; white-space: pre-wrap; }
  .txt:last-child { border-bottom: 0; }
  .txt b { display: block; font-size: 10px; text-transform: uppercase; color: #444; margin-bottom: 2px; }
  .costline { display: flex; justify-content: space-between; padding: 8px; font-weight: 700; }
  .stamp { display: inline-block; margin-top: 6px; border: 2px solid #15803d; color: #15803d; font-weight: 700;
           padding: 2px 10px; text-transform: uppercase; letter-spacing: .1em; font-size: 11px; }
  .stamp.pending { border-color: #b45309; color: #b45309; }
  .stamp.rejected, .stamp.cancelled { border-color: #b91c1c; color: #b91c1c; }
  .sig { display: flex; gap: 24px; padding: 36px 10px 10px; }
  .sig > div { flex: 1; border-top: 1px solid #333; padding-top: 4px; text-align: center; font-size: 10px; }
  .sig b { display: block; font-size: 12px; }
`;

const STAMP: Record<DowngradeStatus, string> = {
  pending: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

/** Print the downgrade form (or save it as PDF from the print dialog). */
export function printDowngradeForm(d: Downgrade): void {
  const approver = d.status === "approved" || d.status === "rejected" ? d.reviewed_by_name : null;
  const body = `
    <style>${FORM_CSS}</style>
    <div class="wrap">
      <div class="head">
        <div class="brand">
          <img src="${esc(logoUrl)}" alt="Cansport" />
          <div><h1>DOWNGRADE FORM</h1><div class="xs muted">Rejections &amp; Wastages</div></div>
        </div>
        <div class="right">
          <div class="bold">No. ${esc(d.downgrade_no)}</div>
          <div>Date: ${esc(fmtDate(d.request_date))}</div>
          <span class="stamp ${d.status}">${STAMP[d.status]}</span>
        </div>
      </div>

      <div class="box"><div class="bh">1. Basic details</div>
        <table>
          <tr><td class="k">Name</td><td>${esc(d.requester_name)}</td><td class="k">Department</td><td>${esc(d.department_name || "—")}</td></tr>
          <tr><td class="k">Item Name</td><td>${esc(d.item_name)}</td><td class="k">Quantity</td><td>${esc(Number(d.quantity).toLocaleString())} ${esc(d.unit)}</td></tr>
          <tr><td class="k">Original Grade</td><td class="bold">${esc(d.original_grade_name)}</td><td class="k">Proposed Down Grade</td><td class="bold">${esc(d.proposed_grade_name)}</td></tr>
        </table>
      </div>

      <div class="box"><div class="bh">2. Reason for downgrading</div>
        <div class="txt"><b>Issue</b>${esc(d.issue)}</div>
        <div class="txt"><b>Why original grade cannot be used</b>${esc(d.why_original_unusable)}</div>
        <div class="txt"><b>Reason for converting</b>${esc(d.reason_for_converting)}</div>
      </div>

      <div class="box"><div class="bh">Downgrade costing</div>
        <table>
          <tr><td class="k">Original grade rate</td><td>${esc(rs(d.original_rate))} / ${esc(d.unit)}</td>
              <td class="k">Downgraded rate</td><td>${esc(rs(d.downgraded_rate))} / ${esc(d.unit)}</td></tr>
        </table>
        <div class="costline">
          <span>Downgrade loss = (${esc(rs(d.original_rate))} − ${esc(rs(d.downgraded_rate))}) × ${esc(Number(d.quantity).toLocaleString())}</span>
          <span>${esc(rs(d.cost_loss))}</span>
        </div>
      </div>

      <div class="box"><div class="bh">3. Approval</div>
        <table>
          <tr><td class="k">Status</td><td class="bold">${STAMP[d.status]}</td><td class="k">Approved / Rejected by</td><td>${esc(approver || "—")}</td></tr>
          <tr><td class="k">Date &amp; time</td><td>${esc(approver ? fmtStamp(d.reviewed_at) : "—")}</td><td class="k">Remarks</td><td>${esc(d.review_notes || "—")}</td></tr>
        </table>
        <div class="sig">
          <div><b>${esc(d.requester_name)}</b>Requested by</div>
          <div><b>&nbsp;</b>Department Head</div>
          <div><b>${d.status === "approved" ? esc(d.reviewed_by_name || "") : "&nbsp;"}</b>Super Admin</div>
        </div>
      </div>

      <div class="xs muted" style="display:flex;justify-content:space-between;gap:12px">
        <span>This form records a grade decision. No stock, ledger or production quantity is changed. The loss is reported in R&amp;W Analytics once approved.</span>
        <span>Printed ${esc(format(new Date(), "dd MMM yyyy HH:mm"))}</span>
      </div>
    </div>`;
  printDocument(`Downgrade Form ${d.downgrade_no}`, body);
}
