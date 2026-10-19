// MPH Loss Reasons — shared helpers.
//
// Authorized / Used MPH per department for a production date, computed the same
// way as the MPH Analysis page (src/pages/labour/LabourMPHAnalysisPage.tsx):
//   Authorized = Σ quantity_produced × MPH number (mph_calculating_numbers)
//   Used       = Σ labour_productivity_targets.mph
// Net < 0 is a loss that the Production Coordinator must explain.
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

export const MPH_LOSS_CATEGORIES = ["Labour", "Utilities", "Material", "Machine", "Quality", "Planning", "Other"];

// Reasons must add up to the loss within this many MPH (same as the database check).
export const MPH_LOSS_TOLERANCE = 0.05;

// Edits go through the database functions, which check these roles again.
export const MPH_LOSS_EDIT_ROLES = ["super_admin", "production_coordinator"];

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const fmtMph = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export async function fetchDepartmentMph(date: string): Promise<DepartmentMph[]> {
  const [deptRes, mphRes, prodRes, usedRes] = await Promise.all([
    supabase.from("production_departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("mph_calculating_numbers").select("department_id, sub_department_id, mph_number").eq("is_active", true),
    supabase
      .from("production_entries")
      .select("department_id, sub_department_id, quantity_produced")
      .eq("entry_date", date)
      .limit(10000),
    supabase
      .from("labour_productivity_targets")
      .select("department_id, mph")
      .eq("target_date", date)
      .limit(10000),
  ]);
  for (const res of [deptRes, mphRes, prodRes, usedRes]) {
    if (res.error) throw res.error;
  }

  const mphNumber = (departmentId: string | null, subDepartmentId: string | null) => {
    const row = (mphRes.data ?? []).find(
      (m) => m.department_id === departmentId && (m.sub_department_id || null) === (subDepartmentId || null)
    );
    return row ? Number(row.mph_number || 0) : 0;
  };

  const byDept: Record<string, { output: number; authorized: number; used: number }> = {};
  const bucket = (id: string) => (byDept[id] ??= { output: 0, authorized: 0, used: 0 });

  (prodRes.data ?? []).forEach((e) => {
    if (!e.department_id) return;
    const qty = Number(e.quantity_produced || 0);
    const b = bucket(e.department_id);
    b.output += qty;
    b.authorized += qty * mphNumber(e.department_id, e.sub_department_id);
  });
  (usedRes.data ?? []).forEach((e) => {
    if (!e.department_id) return;
    bucket(e.department_id).used += Number(e.mph || 0);
  });

  return (deptRes.data ?? [])
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
