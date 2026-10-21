// Shared definitions for Admin & Facilities → office equipment and tickets
// (EQT-…). The rules live in the database: see
// supabase/migrations/20261110120700_facilities_equipment.sql. Every write goes
// through its facilities_* functions; the tables are read-only here.

import { fcDb, type BadgeVariant } from "@/lib/facilities";

export type TicketStatus = "open" | "assigned" | "in_progress" | "done" | "closed";
export type TicketPriority = "low" | "medium" | "high";
export type TicketCategory = "breakdown" | "preventive" | "cctv" | "other";
export type PaidThrough = "petty_cash" | "supplier_invoice" | "general_expense";

export const TICKET_STATUS_META: Record<TicketStatus, { label: string; variant: BadgeVariant }> = {
  open: { label: "Open", variant: "destructive" },
  assigned: { label: "Assigned", variant: "info" },
  in_progress: { label: "In progress", variant: "warning" },
  done: { label: "Done", variant: "success" },
  closed: { label: "Closed", variant: "secondary" },
};
export const ticketStatusMeta = (s: string) =>
  TICKET_STATUS_META[s as TicketStatus] ?? { label: s, variant: "secondary" as const };

export const OPEN_STATUSES: TicketStatus[] = ["open", "assigned", "in_progress"];

export const PRIORITY_META: Record<TicketPriority, { label: string; variant: BadgeVariant }> = {
  low: { label: "Low", variant: "secondary" },
  medium: { label: "Medium", variant: "warning" },
  high: { label: "High", variant: "destructive" },
};
export const priorityMeta = (p: string) => PRIORITY_META[p as TicketPriority] ?? { label: p, variant: "secondary" as const };

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  breakdown: "Breakdown",
  preventive: "Preventive service",
  cctv: "CCTV",
  other: "Other",
};
export const categoryLabel = (c: string) => CATEGORY_LABEL[c as TicketCategory] ?? c;

export const PAID_THROUGH_LABEL: Record<PaidThrough, string> = {
  petty_cash: "Petty cash voucher",
  supplier_invoice: "Supplier invoice (AMC / vendor)",
  general_expense: "General expense",
};

export const SOURCE_LABEL: Record<string, string> = {
  manual: "Reported",
  camera_check: "Camera daily check",
  action_item: "Cleaning action item",
  service_due: "Service due",
};

export type DueState = "ok" | "due_soon" | "overdue" | "none";
export type AmcState = "ok" | "expiring" | "expired" | "none";

export const DUE_META: Record<DueState, { label: string; variant: BadgeVariant }> = {
  ok: { label: "OK", variant: "success" },
  due_soon: { label: "Due soon", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  none: { label: "No schedule", variant: "secondary" },
};
export const AMC_META: Record<AmcState, { label: string; variant: BadgeVariant }> = {
  ok: { label: "AMC active", variant: "success" },
  expiring: { label: "AMC expiring", variant: "warning" },
  expired: { label: "AMC expired", variant: "destructive" },
  none: { label: "No AMC", variant: "secondary" },
};

export const EQUIPMENT_STATUS_LABEL: Record<string, string> = {
  active: "Active",
  out_of_service: "Out of service",
  retired: "Retired",
};

export type EquipmentType = {
  id: string;
  code: string;
  name: string;
  service_interval_days: number | null;
  service_interval_hours: number | null;
  checklist: string[];
  is_active: boolean;
};

export type Equipment = {
  id: string;
  code: string;
  name: string;
  type_id: string;
  location: string | null;
  fixed_asset_id: string | null;
  vendor_name: string | null;
  amc_vendor_name: string | null;
  amc_start: string | null;
  amc_expiry: string | null;
  service_interval_days: number | null;
  service_interval_hours: number | null;
  last_service_date: string | null;
  run_hours: number;
  last_service_hours: number | null;
  status: "active" | "out_of_service" | "retired";
  remarks: string | null;
  is_active: boolean;
  created_at: string;
  // from v_facilities_equipment_due
  type_name?: string;
  type_code?: string;
  type_checklist?: string[];
  interval_days?: number | null;
  interval_hours?: number | null;
  next_due_date?: string | null;
  hours_to_service?: number | null;
  due_state?: DueState;
  amc_state?: AmcState;
};

type UserRef = { id: string; full_name: string | null } | null;

export type Ticket = {
  id: string;
  ticket_number: string;
  equipment_id: string | null;
  camera_id: string | null;
  location_text: string | null;
  category: TicketCategory;
  source: string;
  source_ref: string | null;
  title: string;
  description: string | null;
  photo_path: string | null;
  priority: TicketPriority;
  status: TicketStatus;
  reported_by: string | null;
  assigned_to: string | null;
  vendor_name: string | null;
  assigned_at: string | null;
  started_at: string | null;
  done_at: string | null;
  done_by: string | null;
  action_taken: string | null;
  parts_used: string | null;
  cost: number | null;
  paid_through: PaidThrough | null;
  payment_ref: string | null;
  run_hours_at_service: number | null;
  closed_by: string | null;
  closed_at: string | null;
  reopened_count: number;
  created_at: string;
  updated_at: string;
  equipment?: { code: string; name: string; location: string | null; type?: { name: string } | null } | null;
  reporter?: UserRef;
  assignee?: UserRef;
};

export type TicketComment = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
  author?: UserRef;
};

export const TICKET_SELECT =
  "*, equipment:facilities_equipment(code, name, location, type:facilities_equipment_types(name)), " +
  "reporter:app_users!facilities_tickets_reported_by_fkey(id, full_name), " +
  "assignee:app_users!facilities_tickets_assigned_to_fkey(id, full_name)";

export const COMMENT_SELECT = "id, body, created_at, created_by, author:app_users!facilities_ticket_comments_created_by_fkey(id, full_name)";

export async function loadEquipmentTypes(): Promise<EquipmentType[]> {
  const { data, error } = await fcDb.from("facilities_equipment_types").select("*").order("name");
  if (error) throw error;
  return data ?? [];
}

export async function loadEquipmentDue(): Promise<Equipment[]> {
  const { data, error } = await fcDb.from("v_facilities_equipment_due").select("*").order("code");
  if (error) throw error;
  return data ?? [];
}

export async function loadTicket(id: string): Promise<Ticket | null> {
  const { data, error } = await fcDb.from("facilities_tickets").select(TICKET_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadComments(ticketId: string): Promise<TicketComment[]> {
  const { data, error } = await fcDb
    .from("facilities_ticket_comments")
    .select(COMMENT_SELECT)
    .eq("ticket_id", ticketId)
    .order("created_at");
  if (error) throw error;
  return data ?? [];
}

export const equipmentLabel = (e: Pick<Equipment, "code" | "name"> | null | undefined) =>
  e ? `${e.code} · ${e.name}` : "—";

/** "4 d", "3 h", "just now" — how long a ticket has been open. */
export function ageLabel(from: string, to?: string | null): string {
  const ms = (to ? new Date(to) : new Date()).getTime() - new Date(from).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return "just now";
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** Where the ticket is / what it concerns, for a list cell. */
export const ticketWhere = (t: Ticket) =>
  t.equipment ? `${t.equipment.code} ${t.equipment.name}` : t.location_text ?? "—";
