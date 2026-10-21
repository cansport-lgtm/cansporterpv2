// Office asset custody (AST-…): who holds which office asset. The asset itself
// stays in the Fixed Asset register; this records issue / return / transfer /
// verification movements. Rules: supabase/migrations/20261110120400_facilities_assets.sql.

import { fcDb, rpc } from "@/lib/facilities";
import type { BadgeVariant } from "@/lib/facilities";

export type MovementType = "issue" | "return" | "transfer" | "verify";
export type AssetCondition = "new" | "good" | "fair" | "damaged";
export type AckStatus = "pending" | "acknowledged" | "on_paper";

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  issue: "Issue", return: "Return", transfer: "Transfer", verify: "Verify",
};

export const CONDITION_META: Record<AssetCondition, { label: string; variant: BadgeVariant }> = {
  new: { label: "New", variant: "info" },
  good: { label: "Good", variant: "success" },
  fair: { label: "Fair", variant: "warning" },
  damaged: { label: "Damaged", variant: "destructive" },
};
export const conditionMeta = (c: string) =>
  CONDITION_META[c as AssetCondition] ?? { label: c, variant: "secondary" as BadgeVariant };

export const ACK_META: Record<AckStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Awaiting acknowledgement", variant: "warning" },
  acknowledged: { label: "Acknowledged", variant: "success" },
  on_paper: { label: "Signed on paper", variant: "secondary" },
};

export type CustodyRow = {
  fixed_asset_id: string;
  asset_code: string;
  name: string;
  category: string;
  status: string;
  department_id: string | null;
  department_name: string | null;
  location_description: string | null;
  serial_number: string | null;
  model: string | null;
  manufacturer: string | null;
  holder_employee_id: string | null;
  holder: string | null;
  holder_name: string | null;
  holder_code: string | null;
  holder_department: string | null;
  since: string | null;
  condition: AssetCondition;
  last_verified_at: string | null;
  accessories: string | null;
};

export async function loadCustody(): Promise<CustodyRow[]> {
  const { data, error } = await fcDb.from("v_facilities_asset_custody").select("*").order("asset_code");
  if (error) throw error;
  return data ?? [];
}

export type MovementRow = {
  id: string;
  movement_number: string;
  fixed_asset_id: string;
  movement_type: MovementType;
  from_employee_id: string | null;
  to_employee_id: string | null;
  movement_date: string;
  condition: AssetCondition;
  accessories: string | null;
  remarks: string | null;
  ack_status: AckStatus;
  acknowledged_at: string | null;
  created_at: string;
  asset?: { asset_code: string; name: string } | null;
  from_employee?: { full_name: string; employee_code: string } | null;
  to_employee?: { full_name: string; employee_code: string } | null;
  actor?: { full_name: string | null } | null;
};

export const MOVEMENT_SELECT =
  "*, asset:fixed_assets!facilities_asset_movements_fixed_asset_id_fkey(asset_code, name)," +
  "from_employee:employees!facilities_asset_movements_from_employee_id_fkey(full_name, employee_code)," +
  "to_employee:employees!facilities_asset_movements_to_employee_id_fkey(full_name, employee_code)," +
  "actor:app_users!facilities_asset_movements_created_by_fkey(full_name)";

export async function loadMovements(limit = 300): Promise<MovementRow[]> {
  const { data, error } = await fcDb
    .from("facilities_asset_movements").select(MOVEMENT_SELECT)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export type MoveInput = {
  fixed_asset_id: string;
  movement_type: MovementType;
  from_employee_id: string | null;
  to_employee_id?: string | null;
  movement_date: string;
  condition: AssetCondition;
  accessories?: string;
  remarks?: string;
  on_paper?: boolean;
};

export const moveAsset = (data: MoveInput) => rpc<string>("facilities_asset_move", { p_data: data });
export const acknowledgeMovement = (id: string) => rpc("facilities_asset_acknowledge", { p_movement_id: id });
export const markOnPaper = (id: string) => rpc("facilities_asset_mark_on_paper", { p_movement_id: id });

/** The employee record linked to a login (NULL when none). */
export async function loadMyEmployee(userId: string): Promise<{ id: string; full_name: string; employee_code: string } | null> {
  const { data, error } = await fcDb
    .from("employees").select("id, full_name, employee_code")
    .eq("app_user_id", userId).eq("is_active", true).limit(1).maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** SIMs an employee holds (table from the SIM sub-module; absent → none). */
export async function loadEmployeeSims(employeeId: string): Promise<{ id: string; sim_number: string; network: string; status: string }[]> {
  try {
    const { data, error } = await fcDb
      .from("facilities_sims").select("id, sim_number, network, status")
      .eq("holder_employee_id", employeeId);
    if (error) return [];
    return data ?? [];
  } catch {
    return [];
  }
}
