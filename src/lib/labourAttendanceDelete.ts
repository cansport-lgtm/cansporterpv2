// Labour attendance delete requests (ADR-…), Labour Productivity module.
//
// A worker's attendance for a day is the daily entry row in
// labour_productivity_targets. Supervisors cannot delete one; they raise a
// delete request with a reason, and the labour_attendance_delete_approver (or a
// super admin) approves it, which deletes the row, or rejects it with a note.
// Every step is written to labour_attendance_delete_log, the log sheet.
//
// All writes go through SECURITY DEFINER functions that check roles in the
// database — see supabase/migrations/20261006120100_labour_attendance_delete_requests.sql.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

// The tables are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ladDb = supabase as any;

export const ATTENDANCE_DELETE_ROUTE = "/labour/attendance-delete-requests";

/** Roles that may raise a delete request (the supervisors who post daily entries). */
export const ATTENDANCE_DELETE_REQUEST_ROLES: AppRole[] = [
  "super_admin",
  "admin",
  "manager",
  "supervisor",
  "operational_manager",
  "floor_incharge",
  "labour_productivity_approver",
  "labour_productivity_poster",
  "labour_attendance_delete_approver",
];

/** Roles that may approve or reject a delete request. */
export const ATTENDANCE_DELETE_APPROVE_ROLES: AppRole[] = ["super_admin", "labour_attendance_delete_approver"];

/** Roles that may open the requests / log sheet page. */
export const ATTENDANCE_DELETE_PAGE_ROLES: AppRole[] = Array.from(
  new Set<AppRole>([...ATTENDANCE_DELETE_REQUEST_ROLES, ...ATTENDANCE_DELETE_APPROVE_ROLES]),
);

export type AttendanceDeleteStatus = "pending" | "approved" | "rejected" | "cancelled";
export type AttendanceDeleteEvent = "submitted" | "approved" | "rejected" | "cancelled" | "entry_deleted";

export interface AttendanceDeleteRequest {
  id: string;
  request_number: string;
  entry_id: string;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  target_date: string;
  department_id: string | null;
  department_name: string | null;
  process_id: string | null;
  process_name: string | null;
  shift: string | null;
  work_type: string | null;
  mph: number | null;
  check_in: string | null;
  check_out: string | null;
  target_quantity: number | null;
  actual_quantity: number | null;
  entry_status: string | null;
  entry_created_by: string | null;
  entry_created_by_name: string | null;
  entry_created_at: string | null;
  entry_snapshot: Record<string, unknown>;
  reason: string;
  status: AttendanceDeleteStatus;
  requested_by: string | null;
  requested_by_name: string | null;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  entry_deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceDeleteLogRow {
  id: string;
  request_id: string;
  request_number: string;
  event: AttendanceDeleteEvent;
  entry_id: string | null;
  employee_id: string | null;
  employee_code: string | null;
  employee_name: string | null;
  target_date: string;
  department_name: string | null;
  process_name: string | null;
  work_type: string | null;
  check_in: string | null;
  check_out: string | null;
  reason: string | null;
  notes: string | null;
  acted_by: string | null;
  acted_by_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export const STATUS_LABEL: Record<AttendanceDeleteStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const STATUS_CLASS: Record<AttendanceDeleteStatus, string> = {
  pending: "bg-amber-500 text-white",
  approved: "bg-green-600 text-white",
  rejected: "bg-red-600 text-white",
  cancelled: "bg-slate-500 text-white",
};

export const EVENT_LABEL: Record<AttendanceDeleteEvent, string> = {
  submitted: "Request submitted",
  approved: "Approved — attendance deleted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  entry_deleted: "Entry deleted directly",
};

export const EVENT_CLASS: Record<AttendanceDeleteEvent, string> = {
  submitted: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-green-600/10 text-green-700 border-green-600/20",
  rejected: "bg-red-600/10 text-red-600 border-red-600/20",
  cancelled: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  entry_deleted: "bg-purple-600/10 text-purple-600 border-purple-600/20",
};

export const workTypeLabel = (w: string | null | undefined): string =>
  w === "half_day" ? "Half day" : w === "full_day" ? "Full day" : w || "-";

/** "HH:mm:ss" / "HH:mm" → "HH:mm". */
export const formatClock = (t: string | null | undefined): string => {
  if (!t) return "";
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "";
};

/**
 * Which attendance-delete actions the signed-in user may take. Reads the role
 * list directly: hasRole() answers true for a super admin whatever is asked, so
 * these flags mean "actually holds a role in the list" (super admin is listed).
 */
export const useAttendanceDeleteAccess = () => {
  const { roles } = useAuth();
  const names = roles.map((r) => r.role as AppRole);
  const has = (list: AppRole[]) => list.some((r) => names.includes(r));
  return {
    isSuperAdmin: names.includes("super_admin"),
    canRequest: has(ATTENDANCE_DELETE_REQUEST_ROLES),
    canApprove: has(ATTENDANCE_DELETE_APPROVE_ROLES),
    canOpenPage: has(ATTENDANCE_DELETE_PAGE_ROLES),
  };
};

export const PENDING_MAP_KEY = "labour-attendance-delete-pending-map";
export const REQUESTS_KEY = "labour-attendance-delete-requests";
export const LOG_KEY = "labour-attendance-delete-log";

/** Pending delete requests for a set of entries, keyed entry_id → request number. */
export const usePendingAttendanceDeleteMap = (entryIds: string[]) =>
  useQuery({
    queryKey: [PENDING_MAP_KEY, entryIds],
    enabled: entryIds.length > 0,
    queryFn: async () => {
      const { data, error } = await ladDb
        .from("labour_attendance_delete_requests")
        .select("id, entry_id, request_number")
        .eq("status", "pending")
        .in("entry_id", entryIds);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((r: { entry_id: string; request_number: string }) => {
        map[r.entry_id] = r.request_number;
      });
      return map;
    },
  });

/** Raise a delete request for an attendance entry. Returns the request id. */
export const submitAttendanceDeleteRequest = async (entryId: string, reason: string): Promise<string> => {
  const { data, error } = await ladDb.rpc("labour_attendance_delete_request", {
    p_entry_id: entryId,
    p_reason: reason,
  });
  if (error) throw error;
  return data as string;
};

/** Approve (deletes the entry) or reject (notes required) a pending request. */
export const reviewAttendanceDeleteRequest = async (id: string, approve: boolean, notes?: string): Promise<string> => {
  const { data, error } = await ladDb.rpc("labour_attendance_delete_review", {
    p_id: id,
    p_approve: approve,
    p_notes: notes?.trim() || null,
  });
  if (error) throw error;
  return data as string;
};

/** Withdraw a pending request (its requester, or an approver). */
export const cancelAttendanceDeleteRequest = async (id: string, reason?: string): Promise<void> => {
  const { error } = await ladDb.rpc("labour_attendance_delete_cancel", {
    p_id: id,
    p_reason: reason?.trim() || null,
  });
  if (error) throw error;
};
