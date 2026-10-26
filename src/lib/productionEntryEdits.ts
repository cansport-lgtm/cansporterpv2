// Production daily entry edit tracking.
//
// Every edit of a production_entries row is logged by the database
// (production_entry_edits) and flagged on the row itself: edit_count,
// last_edited_at / _by / _reason and edited_fields, which holds the ORIGINAL
// value of every field that still differs from what was first saved.
// Screens use these flags to show an "Edited" badge and highlight the
// changed figures; super admins acknowledge edits from the log page or the
// banner. See supabase/migrations/20261118120000_production_entry_edit_tracking.sql
// and docs/PRODUCTION_ENTRY_EDITS.md.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// The new table / RPCs are not all in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const peDb = supabase as any;

export const ENTRY_EDITS_ROUTE = "/production/entry-edits";

/** Non super admins may edit an entry only this long after creating it. */
export const EDIT_WINDOW_MINUTES = 60;
export const EDIT_WINDOW_MS = EDIT_WINDOW_MINUTES * 60 * 1000;

/** Minimum length of the mandatory edit reason (also enforced in the database). */
export const EDIT_REASON_MIN_LENGTH = 5;

/** Tracked fields and their labels, in display order. */
export const EDIT_FIELD_LABELS: Record<string, string> = {
  entry_date: "Date",
  shift: "Shift",
  department_id: "Department",
  sub_department_id: "Sub-department",
  grade_id: "Grade",
  target_production: "Target",
  quantity_produced: "Produced",
  quantity_ok: "OK",
  quantity_rejected: "Rejected",
  remarks: "Remarks",
  machine_id: "Machine",
  operator_id: "Operator",
  supervisor_id: "Supervisor",
  rejections: "Rejection details",
};

export const NUMERIC_EDIT_FIELDS = new Set([
  "target_production",
  "quantity_produced",
  "quantity_ok",
  "quantity_rejected",
]);

/** The edit flags every entry row now carries. */
export interface EditedEntryFlags {
  edit_count?: number | null;
  last_edited_at?: string | null;
  last_edited_by?: string | null;
  last_edit_reason?: string | null;
  /** jsonb from the database: `{ field: originalValue }`; typed loosely to accept the generated Json type. */
  edited_fields?: unknown;
}

export interface ProductionEntryEdit {
  id: string;
  entry_id: string | null;
  edit_no: number;
  entry_date: string;
  shift: string | null;
  department_id: string | null;
  department_name: string | null;
  sub_department_name: string | null;
  grade_id: string | null;
  grade_code: string | null;
  grade_name: string | null;
  edited_by: string | null;
  edited_by_name: string | null;
  edited_at: string;
  reason: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  before_data: Record<string, unknown>;
  after_data: Record<string, unknown>;
  rejections_before: RejectionLine[];
  rejections_after: RejectionLine[];
  summary: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  acknowledged_by_user?: { full_name: string | null } | null;
}

export interface RejectionLine {
  defect_reason_id: string | null;
  defect_reason: string | null;
  quantity: number;
  remarks: string | null;
}

/** True when the entry has been edited at least once since it was first saved. */
export function isEditedEntry(entry: EditedEntryFlags | null | undefined): boolean {
  return Number(entry?.edit_count ?? 0) > 0;
}

/** True when this field still differs from the value first saved. */
export function isEditedField(entry: EditedEntryFlags | null | undefined, field: string): boolean {
  const f = entry?.edited_fields;
  return !!f && typeof f === "object" && !Array.isArray(f) && Object.prototype.hasOwnProperty.call(f, field);
}

/** The value the field had when the entry was first saved (undefined when never edited). */
export function editedOriginal(entry: EditedEntryFlags | null | undefined, field: string): unknown {
  if (!isEditedField(entry, field)) return undefined;
  return (entry!.edited_fields as Record<string, unknown>)[field];
}

/** How many of the given rows carry edits. */
export function countEditedEntries(entries: ReadonlyArray<EditedEntryFlags> | null | undefined): number {
  return (entries ?? []).reduce((n, e) => n + (isEditedEntry(e) ? 1 : 0), 0);
}

export function formatEditValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (NUMERIC_EDIT_FIELDS.has(field)) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : String(value);
  }
  if (field === "rejections") {
    const lines = Array.isArray(value) ? (value as RejectionLine[]) : [];
    if (lines.length === 0) return "none";
    return lines.map((l) => `${l.defect_reason ?? "?"}: ${Number(l.quantity).toLocaleString()}`).join(", ");
  }
  return String(value);
}

/**
 * Minutes left in the edit window for a non super admin, or null when the
 * window has passed. Super admins have no window.
 */
export function editWindowRemainingMinutes(createdAt: string | null | undefined): number | null {
  if (!createdAt) return null;
  const left = EDIT_WINDOW_MS - (Date.now() - new Date(createdAt).getTime());
  return left > 0 ? Math.ceil(left / 60000) : null;
}

/** Columns to select on production_entries to get the edit flags. */
export const EDIT_FLAG_COLUMNS = "edit_count, last_edited_at, last_edited_by, last_edit_reason, edited_fields";

export interface EditEntryPayload {
  entry_date: string;
  shift: string;
  department_id: string;
  sub_department_id: string | null;
  grade_id: string;
  uom_id: string | null;
  target_production: number;
  quantity_produced: number;
  quantity_ok: number;
  quantity_rejected: number;
  remarks: string | null;
}

/**
 * Edit an entry through the database RPC: it enforces the 60-minute window
 * (non super admins), the posting lock and the mandatory reason, replaces
 * the rejection breakdown, logs the edit and sends the notifications.
 */
export async function editProductionEntry(
  entryId: string,
  entry: EditEntryPayload,
  rejections: Array<{ defect_reason_id: string; quantity: number; remarks?: string | null }>,
  reason: string,
): Promise<{ status: string; edit_id: string | null }> {
  const { data, error } = await peDb.rpc("production_entry_edit", {
    p_entry_id: entryId,
    p_entry: entry,
    p_rejections: rejections,
    p_reason: reason,
  });
  if (error) throw error;
  return data as { status: string; edit_id: string | null };
}

export async function acknowledgeProductionEntryEdits(ids: string[]): Promise<number> {
  const { data, error } = await peDb.rpc("production_entry_edits_acknowledge", { p_ids: ids });
  if (error) throw error;
  return Number(data ?? 0);
}

export async function acknowledgeAllProductionEntryEdits(): Promise<number> {
  const { data, error } = await peDb.rpc("production_entry_edits_acknowledge_all");
  if (error) throw error;
  return Number(data ?? 0);
}

const EDIT_SELECT = "*, acknowledged_by_user:app_users!production_entry_edits_acknowledged_by_fkey(full_name)";

/** Edit history of one entry, newest first. */
export function useProductionEntryEdits(entryId: string | null | undefined) {
  return useQuery({
    queryKey: ["production-entry-edits", entryId],
    queryFn: async () => {
      const { data, error } = await peDb
        .from("production_entry_edits")
        .select(EDIT_SELECT)
        .eq("entry_id", entryId)
        .order("edit_no", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ProductionEntryEdit[];
    },
    enabled: !!entryId,
  });
}

/** Edits no super admin has acknowledged yet (super admins only), newest first. */
export function useUnacknowledgedProductionEntryEdits(limit = 50) {
  const { hasRole } = useAuth();
  const enabled = hasRole("super_admin");
  return useQuery({
    queryKey: ["production-entry-edits-open", limit],
    queryFn: async () => {
      const { data, error } = await peDb
        .from("production_entry_edits")
        .select(EDIT_SELECT)
        .is("acknowledged_at", null)
        .order("edited_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ProductionEntryEdit[];
    },
    enabled,
    refetchInterval: 5 * 60 * 1000,
  });
}

/**
 * Keep production entry data on the screen current: whenever any entry is
 * edited (or logged as edited) the given query keys are invalidated, so the
 * badge / highlights appear on every open platform without a reload.
 */
export function useProductionEntriesLive(queryKeyPrefixes: string[] = ["production-entries"]) {
  const queryClient = useQueryClient();
  const keys = queryKeyPrefixes.join("|");
  useEffect(() => {
    const prefixes = keys.split("|").filter(Boolean);
    const invalidate = () => {
      for (const p of prefixes) queryClient.invalidateQueries({ queryKey: [p] });
      queryClient.invalidateQueries({ queryKey: ["production-entry-edits"] });
      queryClient.invalidateQueries({ queryKey: ["production-entry-edits-open"] });
    };
    const channel = supabase
      .channel(`production-entries-live-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "production_entries" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "production_entry_edits" }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [keys, queryClient]);
}
