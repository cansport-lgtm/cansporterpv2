// Shared definitions for the Labour Gate Pass (workers leaving during the day).
// The rules live in the database: supabase/migrations/20261002120100_labour_gate_pass.sql.
// Every write goes through its labour_gate_pass_* functions; the tables are read-only here.

import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

// The labour gate pass tables are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const lgpDb = supabase as any;

export type LabourPassKind = "half_day" | "short_leave";
export type LabourPassStatus =
  | "pending_approval" | "approved" | "out" | "returned" | "not_returned" | "expired" | "rejected" | "cancelled";

export const PASS_KINDS: { value: LabourPassKind; label: string; description: string; badgeClass: string }[] = [
  { value: "half_day", label: "Half day", description: "Leaves and does not come back today — the day is marked Half day when the worker goes out", badgeClass: "bg-amber-50 text-amber-800 ring-amber-200" },
  { value: "short_leave", label: "Short leave", description: "Goes out for a task and comes back — scanned Out and In at the gate", badgeClass: "bg-sky-50 text-sky-700 ring-sky-200" },
];

export const passKindMeta = (k: string) => PASS_KINDS.find((p) => p.value === k) ?? PASS_KINDS[0];

export const STATUS_META: Record<string, { label: string; variant: "warning" | "success" | "destructive" | "secondary" | "info" | "soft" }> = {
  pending_approval: { label: "Pending approval", variant: "warning" },
  approved: { label: "Approved", variant: "info" },
  out: { label: "Out", variant: "success" },
  returned: { label: "Returned", variant: "success" },
  not_returned: { label: "Not returned", variant: "destructive" },
  expired: { label: "Expired", variant: "secondary" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export const statusMeta = (s: string) => STATUS_META[s] ?? { label: s, variant: "secondary" as const };

// Who may apply: the supervisors who post daily entries (and the approver / super admin).
export const APPLY_ROLES = ["super_admin", "labour_gate_pass_approver", "labour_productivity_approver", "labour_productivity_poster", "floor_incharge"];
export const APPROVE_ROLES = ["super_admin", "labour_gate_pass_approver"];
export const GATE_ROLES = ["super_admin", "gate_pass_manager", "gate_security"];

export const hasAnyRole = (roles: { role: string }[], allowed: string[]) => roles.some((r) => allowed.includes(r.role));

export type LabourGatePass = {
  id: string;
  pass_number: string;
  pass_kind: LabourPassKind;
  status: LabourPassStatus;
  pass_date: string;
  employee_id: string;
  department_id: string | null;
  reason: string;
  expected_minutes: number | null;
  leave_time: string | null;
  created_by: string | null;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  approval_remarks: string | null;
  gate_out_at: string | null;
  expected_back_at: string | null;
  gate_in_at: string | null;
  minutes_outside: number | null;
  overdue_notified_at: string | null;
  half_day_marked_at: string | null;
  half_day_rows: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  closed_at: string | null;
  close_note: string | null;
  labour_employees?: {
    employee_code: string;
    full_name: string;
    photo_url: string | null;
    category: string | null;
    production_departments?: { name: string } | null;
  } | null;
  creator?: { full_name: string | null } | null;
  approver?: { full_name: string | null } | null;
  out_guard?: { full_name: string | null } | null;
  in_guard?: { full_name: string | null } | null;
};

export const PASS_SELECT =
  "*," +
  "labour_employees(employee_code, full_name, photo_url, category, production_departments(name))," +
  "creator:app_users!labour_gate_passes_created_by_fkey(full_name)," +
  "approver:app_users!labour_gate_passes_approved_by_fkey(full_name)," +
  "out_guard:app_users!labour_gate_passes_gate_out_by_fkey(full_name)," +
  "in_guard:app_users!labour_gate_passes_gate_in_by_fkey(full_name)";

export const workerLabel = (p: LabourGatePass) =>
  p.labour_employees ? `${p.labour_employees.employee_code} · ${p.labour_employees.full_name}` : "Worker";

/** "12", "lgp12", "LGP-000012" or a scanned URL → "LGP-000012"; anything else (e.g. a worker code) unchanged. */
export function normalizeLabourPassNumber(raw: string): string {
  let text = raw.trim();
  try {
    const url = new URL(text);
    text = url.searchParams.get("lgp") ?? url.pathname.split("/").pop() ?? text;
  } catch {
    /* not a URL */
  }
  const m = text.toUpperCase().match(/^LGP-?(\d+)$/);
  return m ? `LGP-${m[1].padStart(6, "0")}` : text.toUpperCase();
}

export const isLabourPassNumber = (text: string) => /^LGP-?\d+$/i.test(text.trim()) || /[?&/]lgp/i.test(text);

/** Today in the factory's time zone as yyyy-MM-dd. */
export const todayPk = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

export const errorMessage = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong.";

export const fmtDT = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM, HH:mm") : "—");
export const fmtTime = (s: string | null | undefined) => (s ? format(new Date(s), "HH:mm") : "—");

/** Minutes a short leave is past its expected return (0 when not overdue). */
export const overdueMinutes = (p: Pick<LabourGatePass, "status" | "pass_kind" | "expected_back_at">, now = Date.now()) =>
  p.status === "out" && p.pass_kind === "short_leave" && p.expected_back_at
    ? Math.max(0, Math.ceil((now - new Date(p.expected_back_at).getTime()) / 60000))
    : 0;

export type LiveLabourPass = Pick<LabourGatePass, "id" | "pass_number" | "pass_kind" | "status" | "pass_date" | "gate_out_at" | "expected_back_at"> & {
  labour_employees: { employee_code: string; full_name: string } | null;
};

/** Live worker passes: pending approval, approved, or out right now. Refreshes every minute. */
export function useLiveLabourPasses() {
  return useQuery<LiveLabourPass[]>({
    queryKey: ["labour-gate-passes-live"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await lgpDb
        .from("labour_gate_passes")
        .select("id, pass_number, pass_kind, status, pass_date, gate_out_at, expected_back_at, labour_employees(employee_code, full_name)")
        .in("status", ["pending_approval", "approved", "out"])
        .order("gate_out_at", { ascending: true });
      if (error) return [];
      return data ?? [];
    },
  });
}

// Dates marked Half day by a gate pass, for the sheets and the salary.
export type HalfDayMark = { employee_id: string; pass_date: string; pass_number: string; pass_kind: string; status: string; gate_out_at: string | null };

/** Half-day gate pass marks between two dates (yyyy-MM-dd), keyed "employeeId|date". */
export function useGatePassHalfDays(start: string, end: string) {
  const { data } = useQuery<Map<string, HalfDayMark>>({
    queryKey: ["labour-gate-pass-half-days", start, end],
    queryFn: async () => {
      const map = new Map<string, HalfDayMark>();
      const { data: rows, error } = await lgpDb
        .from("v_labour_gate_pass_half_days")
        .select("employee_id, pass_date, pass_number, pass_kind, status, gate_out_at")
        .gte("pass_date", start)
        .lte("pass_date", end);
      // The view is missing until the migration is applied — the sheets still work without it.
      if (error) return map;
      (rows as HalfDayMark[]).forEach((r) => map.set(`${r.employee_id}|${r.pass_date}`, r));
      return map;
    },
  });
  return data ?? new Map<string, HalfDayMark>();
}

/** Print the small worker pass slip with its QR. `qrSvg` is the QR's outerHTML. */
export function printLabourGatePass(p: LabourGatePass, qrSvg: string) {
  const kind = passKindMeta(p.pass_kind);
  const e = p.labour_employees;
  const valid = ["approved", "out", "returned"].includes(p.status);
  const body = `
  <style>
    .lgp { max-width: 420px; margin: 0 auto; border: 1px solid #999; padding: 14px 16px; }
    .lgp .facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; font-size: 12px; margin-top: 10px; }
    .lgp .big { font-size: 18px; font-weight: 700; }
    .lgp .sign { display: flex; gap: 12px; margin-top: 36px; }
    .lgp .sign div { flex: 1; border-top: 1px solid #111; padding-top: 4px; font-size: 10px; text-align: center; }
    .lgp .photo { width: 64px; height: 64px; object-fit: cover; border: 1px solid #bbb; border-radius: 4px; }
  </style>
  <div class="wrap lgp">
    <div class="head" style="margin-bottom:8px; padding-bottom:8px">
      <div>
        <h1 style="font-size:16px">Cansport Global Industries</h1>
        <div class="bold" style="margin-top:6px; letter-spacing:.08em; font-size:13px">WORKER GATE PASS · ${esc(kind.label.toUpperCase())}</div>
        ${!valid ? `<div class="bold" style="color:#b42318">NOT APPROVED — NOT VALID AT THE GATE</div>` : ""}
      </div>
      <div style="text-align:center">${qrSvg}<div class="xs muted">Scan at gate</div></div>
    </div>
    <div style="display:flex; gap:12px; align-items:center">
      ${e?.photo_url ? `<img class="photo" src="${esc(e.photo_url)}" alt="">` : ""}
      <div>
        <div class="big">${esc(e?.full_name ?? "")}</div>
        <div class="muted">${esc(e?.employee_code ?? "")}${e?.production_departments?.name ? ` · ${esc(e.production_departments.name)}` : ""}${e?.category ? ` · ${esc(e.category)}` : ""}</div>
      </div>
    </div>
    <div class="facts">
      <div><span class="muted">Pass no.</span> <b style="font-size:14px">${esc(p.pass_number)}</b></div>
      <div><span class="muted">Date</span> <b>${esc(format(new Date(p.pass_date), "dd MMM yyyy"))}</b></div>
      <div><span class="muted">Kind</span> <b>${esc(kind.label)}</b></div>
      <div><span class="muted">Status</span> <b>${esc(statusMeta(p.status).label)}</b></div>
      ${p.pass_kind === "short_leave" ? `<div><span class="muted">Expected out</span> <b>${esc(p.expected_minutes ?? "")} min</b></div>` : ""}
      ${p.leave_time ? `<div><span class="muted">Leaving at</span> <b>${esc(p.leave_time.slice(0, 5))}</b></div>` : ""}
      <div style="grid-column: span 2"><span class="muted">Reason</span> <b>${esc(p.reason)}</b></div>
      ${p.gate_out_at ? `<div><span class="muted">Out</span> <b>${esc(fmtDT(p.gate_out_at))}</b></div>` : ""}
      ${p.gate_in_at ? `<div><span class="muted">In</span> <b>${esc(fmtDT(p.gate_in_at))}</b></div>` : ""}
    </div>
    <div class="sign">
      <div>Supervisor<br><b>${esc(p.creator?.full_name ?? "")}</b></div>
      <div>Approved by<br><b>${esc(p.approver?.full_name ?? "")}</b></div>
      <div>Security<br>&nbsp;</div>
    </div>
    <p class="xs muted" style="text-align:center; margin-top:10px">Valid only on ${esc(format(new Date(p.pass_date), "dd MMM yyyy"))}. ${p.pass_kind === "half_day" ? "The day is marked Half day when the worker goes out." : "The worker must be scanned back in at the gate."}</p>
  </div>`;
  printDocument(p.pass_number, body);
}
