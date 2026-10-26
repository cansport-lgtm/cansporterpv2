// MPH Loss Reasons — shared helpers.
//
// Authorized / Used MPH per department for a production date, computed the same
// way as the MPH Analysis page (src/pages/labour/LabourMPHAnalysisPage.tsx):
//   Authorized = Σ quantity_produced × MPH number (mph_calculating_numbers)
//              + the department's fixed daily MPH (daily_fixed_mph), on a day
//                it has anyone deployed
//   Used       = Σ labour_productivity_targets.mph
// Net < 0 is a loss that the Production Coordinator must explain.
//
// The fixed daily MPH is for departments with no countable output
// (housekeeping): without it their whole deployment shows as a loss every
// day. It is a flat figure per day, not per worker, so over-staffing still
// shows. Every page that computes Authorized goes through the helpers below
// (MPH_NUMBER_COLUMNS, mphRateLookup, fixedDailyMph) so the figures agree.
//
// fetchMphDay also returns the detail behind those totals — every posted item
// (production entry) and every deployed worker — so the page can show the
// calculation item by item.
//
// Tables: supabase/migrations/20261102120100_mph_loss_reasons.sql
import { supabase } from "@/integrations/supabase/client";

export interface MphLossReason {
  id: string;
  code: string;
  name: string;
  category: string | null;
  description: string | null;
  applies_to_all: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface DepartmentMph {
  department_id: string;
  department_name: string;
  output: number;
  authorized_mph: number;
  used_mph: number;
  net_mph: number;
}

// One posted production entry: output × MPH number = authorized MPH.
export interface MphItemRow {
  item_name: string;
  item_code: string;
  sub_department: string;
  shift: string;
  output: number;
  mph_number: number;
  authorized: number;
}

// One deployed worker: their MPH for the day.
export interface MphWorkerRow {
  employee_code: string;
  employee_name: string;
  process: string;
  shift: string;
  hours: number | null;
  mph: number;
}

export interface DepartmentMphDetail {
  items: MphItemRow[];
  workers: MphWorkerRow[];
  // Fixed daily MPH counted for this department on this date (0 if none).
  fixed_daily_mph: number;
}

// One MPH Master row, as every page should select it.
export interface MphNumberRow {
  department_id: string;
  sub_department_id: string | null;
  mph_number: number | null;
  daily_fixed_mph?: number | null;
  fixed_mph_effective_from?: string | null;
}

export const MPH_NUMBER_COLUMNS = "department_id, sub_department_id, mph_number, daily_fixed_mph, fixed_mph_effective_from";

// (department, sub-department) → MPH number per unit of output.
export function mphRateLookup(rows: MphNumberRow[]) {
  const map = new Map<string, number>();
  rows.forEach((m) => map.set(`${m.department_id}|${m.sub_department_id || ""}`, Number(m.mph_number || 0)));
  return (departmentId: string | null, subDepartmentId: string | null) =>
    departmentId ? map.get(`${departmentId}|${subDepartmentId || ""}`) ?? 0 : 0;
}

// Fixed MPH a department earns on `date` (yyyy-mm-dd). Only department-level
// rows carry it (the database refuses it on sub-department rows), and it
// applies from fixed_mph_effective_from. The caller adds it only on a day the
// department has at least one deployed worker.
export function fixedDailyMph(rows: MphNumberRow[], departmentId: string | null, date: string): number {
  if (!departmentId) return 0;
  return rows.reduce((sum, m) => {
    if (m.department_id !== departmentId || m.sub_department_id) return sum;
    const from = m.fixed_mph_effective_from;
    if (from && from > date) return sum;
    return sum + Number(m.daily_fixed_mph || 0);
  }, 0);
}

// Fixed MPH over a range: one allowance per (department, date) in `deployedDays`,
// the set of dates on which the department had anyone deployed.
export function fixedMphForDays(rows: MphNumberRow[], departmentId: string, deployedDays: Iterable<string>): number {
  let sum = 0;
  for (const date of deployedDays) sum += fixedDailyMph(rows, departmentId, date);
  return sum;
}

export interface MphDay {
  departments: DepartmentMph[];
  detail: Record<string, DepartmentMphDetail>;
}

export const MPH_LOSS_CATEGORIES = ["Labour", "Utilities", "Material", "Machine", "Quality", "Planning", "Other"];

// Reasons must add up to the loss within this many MPH (same as the database check).
export const MPH_LOSS_TOLERANCE = 0.05;

// A department's loss must be explained before submitting when it is at least
// this percent of the department's total (authorized) MPH. A smaller loss can
// be explained, but the report can be submitted without it. Mirrors the
// database check in mph_loss_report_save.
export const MPH_LOSS_REQUIRED_PCT = 10;

// Loss as a percent of the department's total MPH. With no authorized MPH
// any loss is 100% (the whole deployment is unexplained).
export function mphLossPct(d: Pick<DepartmentMph, "authorized_mph" | "net_mph">): number {
  if (d.net_mph >= 0) return 0;
  if (d.authorized_mph <= 0) return 100;
  return (-d.net_mph / d.authorized_mph) * 100;
}

export function mphLossReasonRequired(d: Pick<DepartmentMph, "authorized_mph" | "net_mph">): boolean {
  return d.net_mph < 0 && mphLossPct(d) >= MPH_LOSS_REQUIRED_PCT;
}

// Edits go through the database functions, which check these roles again.
export const MPH_LOSS_EDIT_ROLES = ["super_admin", "production_coordinator"];

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmtMph = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

// "08:00:00" → "08:00"
const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : "");

// Hours between check-in and check-out (overnight shifts wrap past midnight).
const hoursBetween = (checkIn: string | null, checkOut: string | null): number | null => {
  if (!checkIn || !checkOut) return null;
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  let diff = toMin(checkOut) - toMin(checkIn);
  if (diff < 0) diff += 24 * 60;
  return Math.round((diff / 60) * 10) / 10;
};

export async function fetchMphDay(date: string): Promise<MphDay> {
  const [deptRes, subRes, mphRes, prodRes, usedRes] = await Promise.all([
    supabase.from("production_departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("production_sub_departments").select("id, name"),
    supabase.from("mph_calculating_numbers").select(MPH_NUMBER_COLUMNS).eq("is_active", true),
    supabase
      .from("production_entries")
      .select("department_id, sub_department_id, grade_id, shift, quantity_produced, grades(name, code)")
      .eq("entry_date", date)
      .limit(10000),
    supabase
      .from("labour_productivity_targets")
      .select("department_id, employee_id, process_id, shift, mph, check_in, check_out, labour_employees(employee_code, full_name), qa_processes(name)")
      .eq("target_date", date)
      .limit(10000),
  ]);
  for (const res of [deptRes, subRes, mphRes, prodRes, usedRes]) {
    if (res.error) throw res.error;
  }

  const subName = Object.fromEntries((subRes.data ?? []).map((s) => [s.id, s.name]));
  const mphRows = (mphRes.data ?? []) as MphNumberRow[];
  const mphNumber = mphRateLookup(mphRows);

  const byDept: Record<string, { output: number; authorized: number; used: number }> = {};
  const detail: Record<string, DepartmentMphDetail> = {};
  const bucket = (id: string) => (byDept[id] ??= { output: 0, authorized: 0, used: 0 });
  const det = (id: string) => (detail[id] ??= { items: [], workers: [], fixed_daily_mph: 0 });

  (prodRes.data ?? []).forEach((e: any) => {
    if (!e.department_id) return;
    const qty = Number(e.quantity_produced || 0);
    const rate = mphNumber(e.department_id, e.sub_department_id);
    const b = bucket(e.department_id);
    b.output += qty;
    b.authorized += qty * rate;
    det(e.department_id).items.push({
      item_name: e.grades?.name ?? "—",
      item_code: e.grades?.code ?? "",
      sub_department: e.sub_department_id ? subName[e.sub_department_id] ?? "—" : "—",
      shift: e.shift ?? "",
      output: qty,
      mph_number: rate,
      authorized: round1(qty * rate),
    });
  });
  (usedRes.data ?? []).forEach((e: any) => {
    if (!e.department_id) return;
    const mph = Number(e.mph || 0);
    bucket(e.department_id).used += mph;
    det(e.department_id).workers.push({
      employee_code: e.labour_employees?.employee_code ?? "",
      employee_name: e.labour_employees?.full_name ?? "—",
      process: e.qa_processes?.name ?? "—",
      shift: e.shift ? `${e.shift}${e.check_in ? ` · ${fmtTime(e.check_in)}–${fmtTime(e.check_out)}` : ""}` : "",
      hours: hoursBetween(e.check_in, e.check_out),
      mph,
    });
  });

  // Fixed daily MPH: counted once per department, only on a day it has anyone deployed.
  Object.entries(detail).forEach(([id, d]) => {
    if (d.workers.length === 0) return;
    const fixed = fixedDailyMph(mphRows, id, date);
    if (fixed <= 0) return;
    d.fixed_daily_mph = round1(fixed);
    bucket(id).authorized += fixed;
  });

  Object.values(detail).forEach((d) => {
    d.items.sort((a, b) => a.sub_department.localeCompare(b.sub_department) || b.authorized - a.authorized);
    d.workers.sort((a, b) => a.process.localeCompare(b.process) || a.employee_code.localeCompare(b.employee_code));
  });

  const departments = (deptRes.data ?? [])
    .filter((d) => byDept[d.id])
    .map((d) => {
      const s = byDept[d.id];
      return {
        department_id: d.id,
        department_name: d.name,
        output: s.output,
        authorized_mph: round1(s.authorized),
        used_mph: round1(s.used),
        net_mph: round1(s.authorized - s.used),
      };
    });

  return { departments, detail };
}

export async function fetchDepartmentMph(date: string): Promise<DepartmentMph[]> {
  return (await fetchMphDay(date)).departments;
}

// Which reasons a department can pick: active, and either for all departments
// or mapped to this one.
export function reasonsForDepartment(
  reasons: MphLossReason[],
  mapping: { reason_id: string; department_id: string }[],
  departmentId: string
): MphLossReason[] {
  return reasons.filter(
    (r) =>
      r.is_active &&
      (r.applies_to_all || mapping.some((m) => m.reason_id === r.id && m.department_id === departmentId))
  );
}

export const escapeHtml = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
