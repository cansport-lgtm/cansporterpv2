// MPH Loss Reasons — shared helpers.
//
// Authorized / Used MPH per department for a production date, computed the same
// way as the MPH Analysis page (src/pages/labour/LabourMPHAnalysisPage.tsx):
//   Authorized = Σ quantity_produced × MPH number (mph_calculating_numbers)
//   Used       = Σ labour_productivity_targets.mph
// Net < 0 is a loss that the Production Coordinator must explain.
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
}

export interface MphDay {
  departments: DepartmentMph[];
  detail: Record<string, DepartmentMphDetail>;
}

export const MPH_LOSS_CATEGORIES = ["Labour", "Utilities", "Material", "Machine", "Quality", "Planning", "Other"];

// Reasons must add up to the loss within this many MPH (same as the database check).
export const MPH_LOSS_TOLERANCE = 0.05;

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
    supabase.from("mph_calculating_numbers").select("department_id, sub_department_id, mph_number").eq("is_active", true),
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
  const mphNumber = (departmentId: string | null, subDepartmentId: string | null) => {
    const row = (mphRes.data ?? []).find(
      (m) => m.department_id === departmentId && (m.sub_department_id || null) === (subDepartmentId || null)
    );
    return row ? Number(row.mph_number || 0) : 0;
  };

  const byDept: Record<string, { output: number; authorized: number; used: number }> = {};
  const detail: Record<string, DepartmentMphDetail> = {};
  const bucket = (id: string) => (byDept[id] ??= { output: 0, authorized: 0, used: 0 });
  const det = (id: string) => (detail[id] ??= { items: [], workers: [] });

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
