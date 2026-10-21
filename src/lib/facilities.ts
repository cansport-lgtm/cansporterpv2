// Shared definitions for the Admin & Facilities module: the daily security
// camera check, office cleaning inspections, office asset custody, the admin
// store and supply requests, employee SIMs and office equipment tickets.
// The rules live in the database (supabase/migrations/20261110120*_facilities_*.sql):
// every write goes through a facilities_* function; the tables are read-only here.

import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

// The facilities tables are not in the generated types yet.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const fcDb = supabase as any;

export type BadgeVariant = "warning" | "success" | "destructive" | "secondary" | "info" | "soft";

export const FACILITIES_ROLES = {
  manage: ["super_admin", "facilities_manager"],
  operate: ["super_admin", "facilities_manager", "facilities_officer"],
  technician: ["super_admin", "facilities_manager", "facilities_officer", "facilities_technician"],
  cleaning: ["super_admin", "facilities_manager", "facilities_officer", "cleaning_supervisor"],
  settings: ["super_admin"],
} as const;

export type FacilitiesAction = keyof typeof FACILITIES_ROLES;

/** Mirrors facilities_can() in the database; the database is the authority. */
export const facilitiesCan = (roles: { role: string }[], action: FacilitiesAction) =>
  roles.some((r) => (FACILITIES_ROLES[action] as readonly string[]).includes(r.role));

export const errorMessage = (e: unknown) =>
  (e as { message?: string })?.message ?? "Something went wrong.";

export const fmtDate = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy") : "—");
export const fmtDateTime = (s: string | null | undefined) => (s ? format(new Date(s), "dd MMM yyyy, HH:mm") : "—");
export const fmtQty = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return Number.isInteger(v) ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 3 });
};
export const fmtMoney = (n: number | string | null | undefined) =>
  Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

/** Today in the factory's time zone as yyyy-MM-dd (the database dates things in Asia/Karachi). */
export const todayPk = () => {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Karachi" }));
  return format(d, "yyyy-MM-dd");
};

export type FacilitiesEvent = {
  id: string;
  event: string;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
  created_by: string | null;
  actor?: { full_name: string | null } | null;
};

export const EVENTS_SELECT = "id, event, message, details, created_at, created_by, actor:app_users!facilities_events_created_by_fkey(full_name)";

export async function loadEvents(documentType: string, documentId: string): Promise<FacilitiesEvent[]> {
  const { data, error } = await fcDb
    .from("facilities_events")
    .select(EVENTS_SELECT)
    .eq("document_type", documentType)
    .eq("document_id", documentId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export type FacilitiesSettings = {
  camera_check_alarm_time: string;
  amc_alert_days: number;
  ticket_escalation_days: number;
  sim_bill_due_day: number;
};

export async function loadSettings(): Promise<FacilitiesSettings> {
  const { data, error } = await fcDb.from("facilities_settings").select("*").eq("id", true).maybeSingle();
  if (error) throw error;
  return data ?? { camera_check_alarm_time: "11:00", amc_alert_days: 30, ticket_escalation_days: 3, sim_bill_due_day: 10 };
}

/** Call a facilities_* database function and unwrap its result. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await fcDb.rpc(fn, args);
  if (error) throw error;
  return data as T;
}

export type EmployeeRef = { id: string; employee_code: string; full_name: string; department?: { name: string } | null };
export const EMPLOYEE_SELECT = "id, employee_code, full_name, department:production_departments(name)";

export async function loadActiveEmployees(): Promise<EmployeeRef[]> {
  const { data, error } = await fcDb
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("is_active", true)
    .order("full_name");
  if (error) throw error;
  return data ?? [];
}

export const employeeLabel = (e: EmployeeRef | null | undefined) =>
  e ? `${e.full_name} (${e.employee_code})${e.department?.name ? ` · ${e.department.name}` : ""}` : "—";
