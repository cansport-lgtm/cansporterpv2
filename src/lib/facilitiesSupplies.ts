// Admin store and supply requests (SR-…): office consumables kept by the
// admin office and the way employees ask for them. Department head approves
// every request; the admin officer issues from stock.
// Rules: supabase/migrations/20261110120500_facilities_supplies.sql.

import { fcDb, rpc } from "@/lib/facilities";
import type { BadgeVariant } from "@/lib/facilities";

export type SupplyRequestStatus = "draft" | "pending_hod" | "approved" | "issued" | "rejected" | "cancelled";

export const SR_STATUS_META: Record<SupplyRequestStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "secondary" },
  pending_hod: { label: "With department head", variant: "warning" },
  approved: { label: "Approved · to issue", variant: "info" },
  issued: { label: "Issued", variant: "success" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};
export const srStatusMeta = (s: string) =>
  SR_STATUS_META[s as SupplyRequestStatus] ?? { label: s, variant: "secondary" as BadgeVariant };

export type SupplyLine = {
  id: string;
  line_no: number;
  item_id: string;
  requested_qty: number;
  approved_qty: number | null;
  issued_qty: number;
  remarks: string | null;
  item?: { code: string; name: string; units_of_measure?: { symbol: string } | null } | null;
};

export type SupplyRequest = {
  id: string;
  request_number: string;
  department_id: string;
  status: SupplyRequestStatus;
  request_date: string;
  reason: string;
  created_by: string | null;
  created_at: string;
  submitted_at: string | null;
  hod_at: string | null;
  hod_remarks: string | null;
  issued_at: string | null;
  acknowledged_at: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  department?: { name: string } | null;
  requester?: { full_name: string | null } | null;
  hod?: { full_name: string | null } | null;
  issuer?: { full_name: string | null } | null;
  lines?: SupplyLine[];
};

export const SR_SELECT =
  "*," +
  "department:production_departments!facilities_supply_requests_department_id_fkey(name)," +
  "requester:app_users!facilities_supply_requests_created_by_fkey(full_name)," +
  "hod:app_users!facilities_supply_requests_hod_by_fkey(full_name)," +
  "issuer:app_users!facilities_supply_requests_issued_by_fkey(full_name)," +
  "lines:facilities_supply_request_lines(*, item:items!facilities_supply_request_lines_item_id_fkey(code, name, units_of_measure(symbol)))";

export const SR_LIST_SELECT =
  "id, request_number, department_id, status, request_date, reason, created_by, created_at, submitted_at," +
  "department:production_departments!facilities_supply_requests_department_id_fkey(name)," +
  "requester:app_users!facilities_supply_requests_created_by_fkey(full_name)," +
  "lines:facilities_supply_request_lines(id)";

export type SupplyRequestListRow = Pick<SupplyRequest,
  "id" | "request_number" | "department_id" | "status" | "request_date" | "reason" | "created_by" | "created_at" | "submitted_at" | "department" | "requester"
> & { lines: { id: string }[] };

export const sortedLines = (r: SupplyRequest) => [...(r.lines ?? [])].sort((a, b) => a.line_no - b.line_no);
export const effectiveQty = (l: SupplyLine) => (l.approved_qty ?? l.requested_qty);

export async function loadSupplyRequest(id: string): Promise<SupplyRequest | null> {
  const { data, error } = await fcDb.from("facilities_supply_requests").select(SR_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export type SaveInput = { department_id: string; reason: string; lines: { item_id: string; requested_qty: number; remarks?: string }[] };
export const saveSupplyRequest = (id: string | null, data: SaveInput, submit: boolean) =>
  rpc<string>("facilities_supply_request_save", { p_id: id, p_data: data, p_submit: submit });
export const submitSupplyRequest = (id: string) => rpc<string>("facilities_supply_request_submit", { p_id: id });
export const approveSupplyRequest = (id: string, lines: { id: string; approved_qty: number }[], remarks: string) =>
  rpc<string>("facilities_supply_request_approve", { p_id: id, p_lines: lines, p_remarks: remarks || null });
export const rejectSupplyRequest = (id: string, reason: string) =>
  rpc<string>("facilities_supply_request_reject", { p_id: id, p_reason: reason });
export const cancelSupplyRequest = (id: string, reason: string) =>
  rpc<string>("facilities_supply_request_cancel", { p_id: id, p_reason: reason || null });
export const issueSupplyRequest = (id: string, lines: { id: string; issued_qty: number }[]) =>
  rpc<string>("facilities_supply_request_issue", { p_id: id, p_lines: lines });
export const acknowledgeSupplyRequest = (id: string) => rpc("facilities_supply_request_acknowledge", { p_id: id });

export type StoreItemRow = {
  item_id: string;
  on_hand: number;
  reorder_level: number;
  reorder_qty: number;
  location: string | null;
  is_active: boolean;
  updated_at: string;
  item?: { code: string; name: string; unit_price: number | null; units_of_measure?: { symbol: string } | null } | null;
};
export const STORE_ITEM_SELECT = "*, item:items!facilities_store_items_item_id_fkey(code, name, unit_price, units_of_measure(symbol))";

export async function loadStoreItems(): Promise<StoreItemRow[]> {
  const { data, error } = await fcDb.from("facilities_store_items").select(STORE_ITEM_SELECT);
  if (error) throw error;
  return ((data ?? []) as StoreItemRow[]).sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? ""));
}

export type ShortageRow = {
  item_id: string; item_code: string; item_name: string; uom: string | null;
  on_hand: number; reorder_level: number; reorder_qty: number; location: string | null; unit_price: number;
};
export async function loadShortage(): Promise<ShortageRow[]> {
  const { data, error } = await fcDb.from("v_facilities_store_shortage").select("*").order("item_name");
  if (error) throw error;
  return data ?? [];
}

export type LedgerRow = {
  id: string; item_id: string; entry_type: string; qty: number; balance_after: number;
  ref_type: string | null; ref_id: string | null; reason: string | null; created_at: string;
  actor?: { full_name: string | null } | null;
};
export async function loadLedger(itemId: string): Promise<LedgerRow[]> {
  const { data, error } = await fcDb
    .from("facilities_store_ledger")
    .select("*, actor:app_users!facilities_store_ledger_created_by_fkey(full_name)")
    .eq("item_id", itemId).order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return data ?? [];
}

export const saveStoreItem = (itemId: string, data: { reorder_level?: number; reorder_qty?: number; location?: string; is_active?: boolean }) =>
  rpc("facilities_store_item_save", { p_item_id: itemId, p_data: data });
export const adjustStock = (itemId: string, qty: number, reason: string, entryType: "opening" | "adjustment") =>
  rpc<number>("facilities_store_adjust", { p_item_id: itemId, p_qty: qty, p_reason: reason, p_entry_type: entryType });
export const receiveStock = (itemId: string, qty: number) =>
  rpc<number>("facilities_store_receive", { p_item_id: itemId, p_qty: qty, p_ref_type: null, p_ref_id: null });
export const reorderToPrq = (itemIds: string[] | null, departmentId: string, purpose: string) =>
  rpc<string>("facilities_store_reorder_to_prq", { p_item_ids: itemIds, p_department_id: departmentId, p_purpose: purpose || null });

export type OfficeItem = { id: string; code: string; name: string; unit_price: number | null; units_of_measure?: { symbol: string } | null };
export async function loadOfficeItems(): Promise<OfficeItem[]> {
  const { data, error } = await fcDb
    .from("items").select("id, code, name, unit_price, units_of_measure(symbol)")
    .eq("category", "office_supplies").eq("is_active", true).order("name");
  if (error) throw error;
  return data ?? [];
}

export type DepartmentRef = { id: string; name: string; code: string };
export async function loadDepartments(): Promise<DepartmentRef[]> {
  const { data, error } = await fcDb.from("production_departments").select("id, name, code, is_active").order("name");
  if (error) throw error;
  return (data ?? []).filter((d: { is_active: boolean | null }) => d.is_active !== false);
}

export async function loadHeadDepartments(userId: string): Promise<string[]> {
  const { data, error } = await fcDb.from("purchase_request_department_heads").select("department_id").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r: { department_id: string }) => r.department_id);
}
