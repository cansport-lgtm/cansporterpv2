// Labour advances and travel advances, Labour Productivity module.
//
// Both are deducted from the worker's salary on the Labour Salary page.
// Anyone with a login records one; only a super admin may adjust (edit or
// delete) one, always with a reason, and never while the labour salary for
// that month is locked. The rules are enforced in the database by the
// labour_advance_guard trigger and labour_advance_delete() — see
// supabase/migrations/20261012120000_labour_advance_adjustments.sql.

import { useQuery } from "@tanstack/react-query";
import { endOfMonth, format, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

// The RPC and the new columns are not all in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const advDb = supabase as any;

export type AdvanceKind = "advance" | "travel";

export const ADVANCE_REASON_MIN = 5;

export const ADVANCE_TABLE: Record<AdvanceKind, "labour_advances" | "labour_travel_advances"> = {
  advance: "labour_advances",
  travel: "labour_travel_advances",
};

export const ADVANCE_LABEL: Record<AdvanceKind, string> = {
  advance: "Advance",
  travel: "Travel Advance",
};

/** Query keys the Labour Salary page uses for each kind; invalidated after every change. */
export const ADVANCE_PAGE_QUERY_KEY: Record<AdvanceKind, string> = {
  advance: "labour-advances",
  travel: "labour-travel-advances",
};

export interface LabourAdvance {
  id: string;
  advance_date: string;
  amount: number;
  remarks: string | null;
  adjustment_reason: string | null;
  updated_at: string | null;
}

/** First and last day of a "yyyy-MM" month as ISO dates. */
export const monthRange = (month: string) => {
  const start = parseISO(`${month}-01`);
  return { start: format(start, "yyyy-MM-dd"), end: format(endOfMonth(start), "yyyy-MM-dd") };
};

export const monthLabel = (month: string) => format(parseISO(`${month}-01`), "MMMM yyyy");

export const reasonTooShort = (reason: string) => reason.trim().length < ADVANCE_REASON_MIN;

/** Delete an advance with a reason. Super admin only; the database refuses a locked month. */
export const deleteLabourAdvance = async (kind: AdvanceKind, id: string, reason: string) => {
  const { error } = await advDb.rpc("labour_advance_delete", {
    p_kind: kind,
    p_id: id,
    p_reason: reason.trim(),
  });
  if (error) throw error;
};

export interface AdvanceHistoryEntry {
  id: string;
  action: "create" | "update" | "delete";
  created_at: string | null;
  user_name: string | null;
  before: { advance_date?: string; amount?: number; remarks?: string | null } | null;
  after: { advance_date?: string; amount?: number; remarks?: string | null } | null;
  reason: string | null;
}

/**
 * Every create / update / delete of this worker's advances in the month, from
 * the central audit trail (audit_row_change writes a row per change).
 */
export const useLabourAdvanceHistory = (kind: AdvanceKind, employeeId: string | undefined, month: string, enabled: boolean) =>
  useQuery({
    queryKey: ["labour-advance-history", kind, employeeId, month],
    queryFn: async (): Promise<AdvanceHistoryEntry[]> => {
      if (!employeeId) return [];
      const table = ADVANCE_TABLE[kind];
      const { start, end } = monthRange(month);
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, created_at, old_values, new_values, app_users!audit_log_user_id_fkey (full_name)")
        .eq("record_type", table)
        .or(`new_values->>employee_id.eq.${employeeId},old_values->>employee_id.eq.${employeeId}`)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data || []) as any[])
        .map((row) => {
          const before = (row.old_values as AdvanceHistoryEntry["before"]) ?? null;
          const after = (row.new_values as AdvanceHistoryEntry["after"]) ?? null;
          return {
            id: row.id as string,
            action: row.action as AdvanceHistoryEntry["action"],
            created_at: row.created_at as string | null,
            user_name: (row.app_users?.full_name as string | undefined) ?? null,
            before,
            after,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            reason: ((after as any)?.adjustment_reason ?? (before as any)?.adjustment_reason ?? null) as string | null,
          };
        })
        // Keep changes that touch this month (the row's date before or after the change)
        .filter((e) => {
          const dates = [e.before?.advance_date, e.after?.advance_date].filter(Boolean) as string[];
          return dates.some((d) => d >= start && d <= end);
        })
        // labour_advance_delete() writes the reason onto the row just before
        // deleting it; that reason-only update is part of the delete, not a change.
        .filter(
          (e) =>
            e.action !== "update" ||
            e.before?.amount !== e.after?.amount ||
            e.before?.advance_date !== e.after?.advance_date ||
            (e.before?.remarks ?? null) !== (e.after?.remarks ?? null),
        );
    },
    enabled: enabled && !!employeeId,
  });
