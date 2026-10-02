// Shared definitions for the person gate passes: workers (Labour module, LGP-…)
// and staff (HR module, SGP-…). Both flows are the same — apply, approve, scan
// Out / In at the gate, half-day marking — and differ only in the tables,
// roles, routes and wording, which a `PersonPassVariant` carries.
//
// The rules live in the database:
//   workers  supabase/migrations/20261002120100_labour_gate_pass.sql
//   staff    supabase/migrations/20261003120100_staff_gate_pass.sql
// Every write goes through the <prefix>_* functions; the tables are read-only here.

import { format } from "date-fns";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esc, printDocument } from "@/lib/printDocument";

// The gate pass tables are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ppDb = supabase as any;

export type PassKind = "half_day" | "short_leave" | "official_duty";
export type PassStatus =
  | "pending_approval" | "approved" | "out" | "returned" | "not_returned" | "expired" | "rejected" | "cancelled";

export type PersonPassVariant = {
  key: "worker" | "staff";
  /** Pass number prefix: LGP / SGP. */
  prefix: string;
  /** "worker" / "staff member" — used mid-sentence. */
  noun: string;
  /** "Worker" / "Staff" — used in titles and badges. */
  label: string;
  module: "labour" | "hr";
  /** Pass kinds this variant offers. */
  kinds: PassKind[];
  /**
   * Self-service variant: the logged-in staff member raising and viewing their own
   * passes (official duty only), reached at /my-gate-pass without any HR role.
   */
  selfService?: boolean;
  basePath: string;
  table: string;
  eventsTable: string;
  settingsTable: string;
  halfDayView: string;
  employeeTable: string;
  /** Extra columns of the employee row to select besides code, name, photo, department. */
  personExtraSelect: string;
  fnPrefix: string;
  queryPrefix: string;
  applyRoles: string[];
  approveRoles: string[];
  gateRoles: string[];
  /** "supervisors (labour productivity posters / approvers, floor incharge)" */
  applyRolesText: string;
  /** "the labour gate pass approver" */
  approverText: string;
  /** Signature line on the slip and "applied by" wording: "Supervisor" / "HR". */
  applicantLabel: string;
  iconColor: string;
  accentButton: string;
  accentSelected: string;
  listTitle: string;
  listDescription: string;
  newTitle: string;
  approvalsTitle: string;
  approvalsDescription: string;
  /** Form info box: what a half-day pass does when the person goes out. */
  halfDayEffect: string;
  /** Detail-page banner once the day is marked. */
  halfDayMarkedText: (rows: number | null) => string;
  /** Gate Check result line after a half-day Out. */
  halfDayGateText: (rows: number | null) => string;
  /** Second line under the name: category (workers) or designation (staff). */
  personSubline: (p: PassPerson | null | undefined) => string;
};

export type PassPerson = {
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  category?: string | null;
  designations?: { name: string } | null;
  production_departments?: { name: string } | null;
};

export const WORKER_PASS: PersonPassVariant = {
  key: "worker",
  prefix: "LGP",
  noun: "worker",
  label: "Worker",
  module: "labour",
  kinds: ["half_day", "short_leave", "official_duty"],
  basePath: "/labour/gate-pass",
  table: "labour_gate_passes",
  eventsTable: "labour_gate_pass_events",
  settingsTable: "labour_gate_pass_settings",
  halfDayView: "v_labour_gate_pass_half_days",
  employeeTable: "labour_employees",
  personExtraSelect: "category",
  fnPrefix: "labour_gate_pass",
  queryPrefix: "labour-gate-pass",
  applyRoles: ["super_admin", "labour_gate_pass_approver", "labour_productivity_approver", "labour_productivity_poster", "floor_incharge"],
  approveRoles: ["super_admin", "labour_gate_pass_approver"],
  gateRoles: ["super_admin", "gate_pass_manager", "gate_security"],
  applyRolesText: "supervisors (labour productivity posters / approvers, floor incharge)",
  approverText: "the labour gate pass approver",
  applicantLabel: "Supervisor",
  iconColor: "bg-emerald-600 text-white",
  accentButton: "bg-emerald-700 hover:bg-emerald-800",
  accentSelected: "border-emerald-600 bg-emerald-50",
  listTitle: "Worker Gate Passes",
  listDescription: "Half days, short leaves and company work through the gate, applied by supervisors and approved by the labour gate pass approver",
  newTitle: "New Worker Gate Pass",
  approvalsTitle: "Worker Gate Pass Approvals",
  approvalsDescription: "Passes waiting for the labour gate pass approver, and short leaves overdue at the gate (company work is never overdue)",
  halfDayEffect: "When the guard scans the worker out, the day is marked Half day: every productivity entry for that date becomes a half day, and any entry added later for that date stays a half day.",
  halfDayMarkedText: (rows) => `${rows ?? 0} productivity entr${rows === 1 ? "y" : "ies"} set to half day. Any entry added later for that date stays a half day.`,
  halfDayGateText: (rows) => `Half day marked for today (${rows ?? 0} productivity entr${rows === 1 ? "y" : "ies"} updated).`,
  personSubline: (p) => p?.category ?? "",
};

export const STAFF_PASS: PersonPassVariant = {
  key: "staff",
  prefix: "SGP",
  noun: "staff member",
  label: "Staff",
  module: "hr",
  kinds: ["half_day", "short_leave", "official_duty"],
  basePath: "/hr/gate-pass",
  table: "staff_gate_passes",
  eventsTable: "staff_gate_pass_events",
  settingsTable: "staff_gate_pass_settings",
  halfDayView: "v_staff_gate_pass_half_days",
  employeeTable: "employees",
  personExtraSelect: "designations(name)",
  fnPrefix: "staff_gate_pass",
  queryPrefix: "staff-gate-pass",
  applyRoles: ["super_admin", "staff_gate_pass_approver", "hr_manager", "hr_officer"],
  approveRoles: ["super_admin", "staff_gate_pass_approver"],
  gateRoles: ["super_admin", "gate_pass_manager", "gate_security"],
  applyRolesText: "HR (HR manager / officer)",
  approverText: "the staff gate pass approver",
  applicantLabel: "HR",
  iconColor: "bg-purple-600 text-white",
  accentButton: "bg-purple-700 hover:bg-purple-800",
  accentSelected: "border-purple-600 bg-purple-50",
  listTitle: "Staff Gate Passes",
  listDescription: "Half days and short leaves through the gate, applied by HR and approved by the staff gate pass approver",
  newTitle: "New Staff Gate Pass",
  approvalsTitle: "Staff Gate Pass Approvals",
  approvalsDescription: "Passes waiting for the staff gate pass approver, and short leaves overdue at the gate",
  halfDayEffect: "When the guard scans the staff member out, the day is marked Half day in HR attendance: the attendance row for that date becomes Half Day (created if missing), and anything written later for that date stays a half day. The Salary Sheet counts it as half a day.",
  halfDayMarkedText: () => "HR attendance for that date is Half Day. Anything written later for that date (Attendance page, Excel import) stays a half day.",
  halfDayGateText: () => "Half day marked for today in HR attendance.",
  personSubline: (p) => p?.designations?.name ?? "",
};

/** The staff member's own view: raise and follow official duty passes without an HR role. */
export const STAFF_SELF_PASS: PersonPassVariant = {
  ...STAFF_PASS,
  selfService: true,
  kinds: ["official_duty"],
  basePath: "/my-gate-pass",
  listTitle: "My Gate Passes",
  listDescription: "Your company work passes: raise one before you go out, show it to the guard going out and coming back",
  newTitle: "Go out on company work",
};

/** Variants the Gate Check page recognises by prefix (the self-service view shares the staff prefix). */
export const PERSON_PASS_VARIANTS: PersonPassVariant[] = [WORKER_PASS, STAFF_PASS];

export const isOfficialDuty = (k: string | null | undefined) => k === "official_duty";

/** Did this pass mark a half day? Official duty never does, even when not scanned back in. */
export const marksHalfDay = (p: Pick<PersonGatePass, "pass_kind" | "status">) =>
  (p.pass_kind === "half_day" && p.status === "out") || (p.status === "not_returned" && !isOfficialDuty(p.pass_kind));

const KIND_META: Record<PassKind, { label: string; description: (noun: string) => string; badgeClass: string }> = {
  half_day: { label: "Half day", description: (noun) => `Leaves and does not come back today — the day is marked Half day when the ${noun} goes out`, badgeClass: "bg-amber-50 text-amber-800 ring-amber-200" },
  short_leave: { label: "Short leave", description: () => "Personal errand — goes out and comes back, scanned Out and In at the gate. Not back by day end → half day", badgeClass: "bg-sky-50 text-sky-700 ring-sky-200" },
  official_duty: { label: "Official duty", description: () => "Company work — purchases, bank, site visit. Scanned Out and In at the gate. Attendance is never touched", badgeClass: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
};

export const passKinds = (v: PersonPassVariant): { value: PassKind; label: string; description: string; badgeClass: string }[] =>
  v.kinds.map((value) => ({ value, label: KIND_META[value].label, description: KIND_META[value].description(v.noun), badgeClass: KIND_META[value].badgeClass }));

export const passKindMeta = (k: string) => {
  const m = KIND_META[k as PassKind] ?? KIND_META.half_day;
  return { value: (KIND_META[k as PassKind] ? k : "half_day") as PassKind, label: m.label, description: m.description("person"), badgeClass: m.badgeClass };
};

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

/** Status label; an official duty pass that was never scanned back in reads "Not scanned in", not "Not returned". */
export const statusMeta = (s: string, kind?: string | null) =>
  s === "not_returned" && isOfficialDuty(kind)
    ? { label: "Not scanned in", variant: "warning" as const }
    : STATUS_META[s] ?? { label: s, variant: "secondary" as const };

export const hasAnyRole = (roles: { role: string }[], allowed: string[]) => roles.some((r) => allowed.includes(r.role));

export type PersonGatePass = {
  id: string;
  pass_number: string;
  pass_kind: PassKind;
  status: PassStatus;
  pass_date: string;
  employee_id: string;
  department_id: string | null;
  reason: string;
  destination: string | null;
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
  person?: PassPerson | null;
  creator?: { full_name: string | null } | null;
  approver?: { full_name: string | null } | null;
  out_guard?: { full_name: string | null } | null;
  in_guard?: { full_name: string | null } | null;
};

/** Employee columns embedded as `person` on a pass row. */
export const personSelect = (v: PersonPassVariant, extra = true) =>
  `person:${v.employeeTable}(employee_code, full_name, photo_url${extra ? `, ${v.personExtraSelect}` : ""}, production_departments(name))`;

export const passSelect = (v: PersonPassVariant) =>
  "*," +
  `${personSelect(v)},` +
  `creator:app_users!${v.table}_created_by_fkey(full_name),` +
  `approver:app_users!${v.table}_approved_by_fkey(full_name),` +
  `out_guard:app_users!${v.table}_gate_out_by_fkey(full_name),` +
  `in_guard:app_users!${v.table}_gate_in_by_fkey(full_name)`;

export const personLabel = (p: PersonGatePass, v: PersonPassVariant) =>
  p.person ? `${p.person.employee_code} · ${p.person.full_name}` : v.label;

/** Query keys per variant; the worker keys match what the labour pages always used. */
export const passKeys = (v: PersonPassVariant) => ({
  list: `${v.queryPrefix}es`,
  live: `${v.queryPrefix}es-live`,
  approvals: `${v.queryPrefix}-approvals`,
  halfDays: `${v.queryPrefix}-half-days`,
  halfDaysCount: `${v.queryPrefix}-half-days-count`,
  detail: v.queryPrefix,
  events: `${v.queryPrefix}-events`,
  settings: `${v.queryPrefix}-settings`,
  existing: `${v.queryPrefix}-existing`,
  rescans: `${v.queryPrefix}-rescans`,
  rescansCount: `${v.queryPrefix}-rescans-count`,
  picker: `${v.queryPrefix}-picker`,
  gateCheck: `gate-check-${v.key}-pass`,
  myEmployee: `${v.queryPrefix}-my-employee`,
});

/** Refresh everything that shows passes of this kind after a write. */
export function invalidatePassQueries(queryClient: QueryClient, v: PersonPassVariant) {
  const k = passKeys(v);
  [k.list, k.live, k.approvals, k.halfDays, k.halfDaysCount, k.rescans, k.rescansCount].forEach((key) =>
    queryClient.invalidateQueries({ queryKey: [key] }));
}

/** "12", "lgp12", "LGP-000012" or a scanned URL → "LGP-000012"; anything else (e.g. an employee code) unchanged. */
export function normalizePersonPassNumber(v: PersonPassVariant, raw: string): string {
  let text = raw.trim();
  try {
    const url = new URL(text);
    text = url.searchParams.get(v.prefix.toLowerCase()) ?? url.pathname.split("/").pop() ?? text;
  } catch {
    /* not a URL */
  }
  const m = text.toUpperCase().match(new RegExp(`^${v.prefix}-?(\\d+)$`));
  return m ? `${v.prefix}-${m[1].padStart(6, "0")}` : text.toUpperCase();
}

export const isPersonPassNumber = (v: PersonPassVariant, text: string) =>
  new RegExp(`^${v.prefix}-?\\d+$`, "i").test(text.trim()) || new RegExp(`[?&/]${v.prefix}`, "i").test(text);

/** Which person pass a scanned / typed text names by its prefix, if any. */
export const detectPersonPassVariant = (text: string) => PERSON_PASS_VARIANTS.find((v) => isPersonPassNumber(v, text)) ?? null;

export const isFullPassNumber = (v: PersonPassVariant, text: string) => new RegExp(`^${v.prefix}-\\d{6}$`).test(text);

/** Today in the factory's time zone as yyyy-MM-dd. */
export const todayPk = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi" }).format(new Date());

export const errorMessage = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong.";

export const fmtDT = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM, HH:mm") : "—");
export const fmtTime = (s: string | null | undefined) => (s ? format(new Date(s), "HH:mm") : "—");

/** Minutes a short leave is past its expected return (0 when not overdue). */
export const overdueMinutes = (p: Pick<PersonGatePass, "status" | "pass_kind" | "expected_back_at">, now = Date.now()) =>
  p.status === "out" && p.pass_kind !== "half_day" && p.expected_back_at
    ? Math.max(0, Math.ceil((now - new Date(p.expected_back_at).getTime()) / 60000))
    : 0;

export type LivePersonPass = Pick<PersonGatePass, "id" | "pass_number" | "pass_kind" | "status" | "pass_date" | "gate_out_at" | "expected_back_at"> & {
  person: { employee_code: string; full_name: string } | null;
};

/** Live passes: pending approval, approved, or out right now. Refreshes every minute. */
export function useLivePersonPasses(v: PersonPassVariant) {
  return useQuery<LivePersonPass[]>({
    queryKey: [passKeys(v).live],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await ppDb
        .from(v.table)
        .select(`id, pass_number, pass_kind, status, pass_date, gate_out_at, expected_back_at, person:${v.employeeTable}(employee_code, full_name)`)
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
export function usePersonPassHalfDays(v: PersonPassVariant, start: string, end: string) {
  const { data } = useQuery<Map<string, HalfDayMark>>({
    queryKey: [passKeys(v).halfDays, start, end],
    queryFn: async () => {
      const map = new Map<string, HalfDayMark>();
      const { data: rows, error } = await ppDb
        .from(v.halfDayView)
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

/** Tooltip text for a sheet cell on a date marked half day by a pass. */
export const halfDayMarkTitle = (mark: HalfDayMark) =>
  `Half Day · gate pass ${mark.pass_number}${mark.gate_out_at ? ` out ${format(new Date(mark.gate_out_at), "HH:mm")}` : ""}`;

/** Print the small pass slip with its QR. `qrSvg` is the QR's outerHTML. */
export function printPersonGatePass(v: PersonPassVariant, p: PersonGatePass, qrSvg: string) {
  const kind = passKindMeta(p.pass_kind);
  const e = p.person;
  const sub = v.personSubline(e);
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
        <div class="bold" style="margin-top:6px; letter-spacing:.08em; font-size:13px">${esc(v.label.toUpperCase())} GATE PASS · ${esc(kind.label.toUpperCase())}</div>
        ${!valid ? `<div class="bold" style="color:#b42318">NOT APPROVED — NOT VALID AT THE GATE</div>` : ""}
      </div>
      <div style="text-align:center">${qrSvg}<div class="xs muted">Scan at gate</div></div>
    </div>
    <div style="display:flex; gap:12px; align-items:center">
      ${e?.photo_url ? `<img class="photo" src="${esc(e.photo_url)}" alt="">` : ""}
      <div>
        <div class="big">${esc(e?.full_name ?? "")}</div>
        <div class="muted">${esc(e?.employee_code ?? "")}${e?.production_departments?.name ? ` · ${esc(e.production_departments.name)}` : ""}${sub ? ` · ${esc(sub)}` : ""}</div>
      </div>
    </div>
    <div class="facts">
      <div><span class="muted">Pass no.</span> <b style="font-size:14px">${esc(p.pass_number)}</b></div>
      <div><span class="muted">Date</span> <b>${esc(format(new Date(p.pass_date), "dd MMM yyyy"))}</b></div>
      <div><span class="muted">Kind</span> <b>${esc(kind.label)}</b></div>
      <div><span class="muted">Status</span> <b>${esc(statusMeta(p.status).label)}</b></div>
      ${p.pass_kind !== "half_day" ? `<div><span class="muted">Expected out</span> <b>${esc(p.expected_minutes ?? "")} min</b></div>` : ""}
      ${p.destination ? `<div><span class="muted">Destination</span> <b>${esc(p.destination)}</b></div>` : ""}
      ${p.leave_time ? `<div><span class="muted">Leaving at</span> <b>${esc(p.leave_time.slice(0, 5))}</b></div>` : ""}
      <div style="grid-column: span 2"><span class="muted">Reason</span> <b>${esc(p.reason)}</b></div>
      ${p.gate_out_at ? `<div><span class="muted">Out</span> <b>${esc(fmtDT(p.gate_out_at))}</b></div>` : ""}
      ${p.gate_in_at ? `<div><span class="muted">In</span> <b>${esc(fmtDT(p.gate_in_at))}</b></div>` : ""}
    </div>
    <div class="sign">
      <div>${esc(v.applicantLabel)}<br><b>${esc(p.creator?.full_name ?? "")}</b></div>
      <div>Approved by<br><b>${esc(p.approver?.full_name ?? (p.approved_at && !p.approved_by ? "Auto (field duty)" : ""))}</b></div>
      <div>Security<br>&nbsp;</div>
    </div>
    <p class="xs muted" style="text-align:center; margin-top:10px">Valid only on ${esc(format(new Date(p.pass_date), "dd MMM yyyy"))}. ${p.pass_kind === "half_day" ? `The day is marked Half day when the ${esc(v.noun)} goes out.` : p.pass_kind === "official_duty" ? "Company work — scan back in at the gate on return. Attendance is not affected." : `The ${esc(v.noun)} must be scanned back in at the gate.`}</p>
  </div>`;
  printDocument(p.pass_number, body);
}

// Self-service: the staff record linked to the current login (employees.app_user_id).
export type MyEmployee = {
  id: string;
  employee_code: string;
  full_name: string;
  photo_url: string | null;
  field_duty_allowed: boolean | null;
  designations?: { name: string } | null;
  production_departments?: { name: string } | null;
};

/** The staff record linked to the logged-in user, or null when the login is not linked. */
export function useMyEmployee(userId: string | null | undefined) {
  return useQuery<MyEmployee | null>({
    queryKey: [passKeys(STAFF_PASS).myEmployee, userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await ppDb
        .from("employees")
        .select("id, employee_code, full_name, photo_url, field_duty_allowed, designations(name), production_departments(name)")
        .eq("app_user_id", userId)
        .eq("is_active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (error) return null;
      return data ?? null;
    },
  });
}

/** Minutes a pass spent (or has spent so far) outside the gate. */
export const minutesOutside = (p: Pick<PersonGatePass, "status" | "gate_out_at" | "gate_in_at" | "minutes_outside">, now = Date.now()) => {
  if (p.minutes_outside != null) return p.minutes_outside;
  if (p.status === "out" && p.gate_out_at) return Math.max(0, Math.ceil((now - new Date(p.gate_out_at).getTime()) / 60000));
  return 0;
};
