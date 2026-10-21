// Admin & Facilities — employee SIMs: register, issue / return and the
// monthly bill per network. The company bears over-limit amounts; they are
// only flagged and reported. Rules live in the database:
// supabase/migrations/20261110120600_facilities_sims.sql.

import { format } from "date-fns";
import { fcDb, rpc, type BadgeVariant, type EmployeeRef } from "@/lib/facilities";

export const SIM_NETWORKS = ["Jazz", "Zong", "Telenor", "Ufone", "Other"] as const;
export type SimNetwork = (typeof SIM_NETWORKS)[number];

export type SimStatus = "in_stock" | "issued" | "suspended" | "lost" | "closed";
export type SimType = "voice" | "data" | "device";

export const SIM_STATUS_META: Record<SimStatus, { label: string; variant: BadgeVariant }> = {
  in_stock: { label: "In stock", variant: "secondary" },
  issued: { label: "Issued", variant: "success" },
  suspended: { label: "Suspended", variant: "warning" },
  lost: { label: "Lost", variant: "destructive" },
  closed: { label: "Closed", variant: "secondary" },
};
export const simStatusMeta = (s: string) =>
  SIM_STATUS_META[s as SimStatus] ?? { label: s, variant: "secondary" as const };

export const SIM_TYPE_LABEL: Record<SimType, string> = { voice: "Voice", data: "Data", device: "Device" };

export type Sim = {
  id: string;
  sim_number: string;
  network: SimNetwork;
  package_name: string | null;
  package_cost: number;
  monthly_limit: number;
  sim_type: SimType;
  status: SimStatus;
  holder_employee_id: string | null;
  handset_asset_id: string | null;
  iccid: string | null;
  puk: string | null;
  remarks: string | null;
  is_active: boolean;
  created_at: string;
  holder?: EmployeeRef | null;
  handset?: { asset_code: string; name: string } | null;
};

export const SIM_SELECT =
  "id, sim_number, network, package_name, package_cost, monthly_limit, sim_type, status, holder_employee_id, handset_asset_id, iccid, puk, remarks, is_active, created_at, " +
  "holder:employees!facilities_sims_holder_employee_id_fkey(id, employee_code, full_name, department:production_departments(name)), " +
  "handset:fixed_assets!facilities_sims_handset_asset_id_fkey(asset_code, name)";

export type SimMovement = {
  id: string;
  movement_number: string;
  sim_id: string;
  movement_type: "issue" | "return" | "status";
  movement_date: string;
  new_status: SimStatus;
  remarks: string | null;
  created_at: string;
  sim?: { sim_number: string; network: string } | null;
  from_employee?: { full_name: string; employee_code: string } | null;
  to_employee?: { full_name: string; employee_code: string } | null;
  actor?: { full_name: string | null } | null;
};

export const SIM_MOVEMENT_SELECT =
  "id, movement_number, sim_id, movement_type, movement_date, new_status, remarks, created_at, " +
  "sim:facilities_sims(sim_number, network), " +
  "from_employee:employees!facilities_sim_movements_from_employee_id_fkey(full_name, employee_code), " +
  "to_employee:employees!facilities_sim_movements_to_employee_id_fkey(full_name, employee_code), " +
  "actor:app_users!facilities_sim_movements_created_by_fkey(full_name)";

export type SimBill = {
  id: string;
  network: SimNetwork;
  bill_month: string;
  status: "draft" | "posted";
  total_amount: number;
  over_limit_total: number;
  over_limit_count: number;
  posted_at: string | null;
  posted_by_user?: { full_name: string | null } | null;
};

export const SIM_BILL_SELECT =
  "id, network, bill_month, status, total_amount, over_limit_total, over_limit_count, posted_at, " +
  "posted_by_user:app_users!facilities_sim_bills_posted_by_fkey(full_name)";

export type SimBillLine = {
  id: string;
  bill_id: string;
  sim_id: string;
  amount: number;
  monthly_limit: number;
  over_limit: number;
  note: string | null;
  sim?: { sim_number: string; package_name: string | null } | null;
  holder?: { full_name: string; employee_code: string } | null;
};

export const SIM_BILL_LINE_SELECT =
  "id, bill_id, sim_id, amount, monthly_limit, over_limit, note, " +
  "sim:facilities_sims(sim_number, package_name), " +
  "holder:employees!facilities_sim_bill_lines_holder_employee_id_fkey(full_name, employee_code)";

export type SimOverLimitRow = {
  sim_id: string;
  sim_number: string;
  network: string;
  holder_name: string | null;
  holder_code: string | null;
  months_over: number;
  total_over: number;
  last_month_over: string;
};

/** First day of a month as yyyy-MM-01, from a yyyy-MM month picker value. */
export const monthStart = (yyyyMm: string) => `${yyyyMm}-01`;
export const fmtMonth = (d: string) => format(new Date(`${d.slice(0, 7)}-01T00:00:00`), "MMM yyyy");

export async function loadSims(): Promise<Sim[]> {
  const { data, error } = await fcDb.from("facilities_sims").select(SIM_SELECT).order("network").order("sim_number");
  if (error) throw error;
  return data ?? [];
}

export const saveSim = (id: string | null, data: Record<string, unknown>) =>
  rpc<string>("facilities_sim_save", { p_id: id, p_data: data });

export const moveSim = (data: Record<string, unknown>) => rpc<string>("facilities_sim_move", { p_data: data });

export const startSimBill = (network: string, month: string) =>
  rpc<string>("facilities_sim_bill_start", { p_network: network, p_month: month });

export const saveSimBillLines = (id: string, lines: { id: string; amount: number }[]) =>
  rpc<number>("facilities_sim_bill_save_lines", { p_id: id, p_lines: lines });

export const postSimBill = (id: string) => rpc<void>("facilities_sim_bill_post", { p_id: id });
export const noteSimBillLine = (lineId: string, note: string) =>
  rpc<void>("facilities_sim_bill_note", { p_line_id: lineId, p_note: note });
export const reopenSimBill = (id: string) => rpc<void>("facilities_sim_bill_reopen", { p_id: id });
