// Security cameras: masters and the daily check (CCK-…). Rules in
// supabase/migrations/20261110120200_facilities_cameras.sql.
import type { ResultOption } from "@/components/facilities/ResultToggle";
import { fcDb, rpc, type BadgeVariant } from "@/lib/facilities";

export type CameraResult = "ok" | "blurry" | "offline" | "damaged" | "no_recording" | "wrong_angle";

export const CAMERA_RESULTS: ResultOption[] = [
  { value: "ok", label: "OK", tone: "ok" },
  { value: "blurry", label: "Blurry", tone: "warn" },
  { value: "offline", label: "Offline", tone: "bad" },
  { value: "damaged", label: "Damaged", tone: "bad" },
  { value: "no_recording", label: "No rec.", tone: "bad" },
  { value: "wrong_angle", label: "Angle", tone: "warn" },
];
export const cameraResultLabel = (r: string | null | undefined) =>
  CAMERA_RESULTS.find((o) => o.value === r)?.label ?? "—";
export const cameraResultVariant = (r: string | null | undefined): BadgeVariant =>
  r === "ok" ? "success" : r === "blurry" || r === "wrong_angle" ? "warning" : r ? "destructive" : "secondary";

export type CheckStatus = "draft" | "submitted" | "reviewed";
export const CHECK_STATUS_META: Record<CheckStatus, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "Submitted", variant: "info" },
  reviewed: { label: "Reviewed", variant: "success" },
};
export const checkStatusMeta = (s: string) => CHECK_STATUS_META[s as CheckStatus] ?? { label: s, variant: "secondary" as const };

export type Recorder = {
  id: string; code: string; name: string; channels: number; expected_retention_days: number;
  location: string | null; is_active: boolean;
};
export type Camera = {
  id: string; code: string; name: string; zone: string | null; recorder_id: string | null; channel_no: number | null;
  ip_address: string | null; fixed_asset_id: string | null; sort_order: number; is_active: boolean;
  recorder?: { code: string } | null;
};
export type CameraCheck = {
  id: string; check_number: string; check_date: string; status: CheckStatus;
  camera_count: number; ok_count: number; fault_count: number; recorder_fault_count: number;
  remarks: string | null; created_by: string | null; created_at: string;
  submitted_at: string | null; reviewed_at: string | null; review_remarks: string | null;
  creator?: { full_name: string | null } | null;
  submitter?: { full_name: string | null } | null;
  reviewer?: { full_name: string | null } | null;
};
export type CameraCheckLine = {
  id: string; camera_id: string; sort_order: number; result: CameraResult | null; remark: string | null;
  photo_path: string | null; ticket_id: string | null;
  camera?: Camera | null;
};
export type CameraCheckRecorder = {
  id: string; recorder_id: string; is_recording: boolean | null; footage_days: number | null;
  hdd_status: "ok" | "warning" | "failed" | null; clock_ok: boolean | null; remark: string | null;
  recorder?: Recorder | null;
};

export const CHECK_SELECT =
  "id, check_number, check_date, status, camera_count, ok_count, fault_count, recorder_fault_count, remarks, created_by, created_at, submitted_at, reviewed_at, review_remarks, " +
  "creator:app_users!facilities_camera_checks_created_by_fkey(full_name), " +
  "submitter:app_users!facilities_camera_checks_submitted_by_fkey(full_name), " +
  "reviewer:app_users!facilities_camera_checks_reviewed_by_fkey(full_name)";

export async function loadCameras(activeOnly = false): Promise<Camera[]> {
  let q = fcDb.from("facilities_cameras").select("*, recorder:facilities_recorders(code)").order("sort_order").order("code");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
export async function loadRecorders(): Promise<Recorder[]> {
  const { data, error } = await fcDb.from("facilities_recorders").select("*").order("code");
  if (error) throw error;
  return data ?? [];
}
export async function loadCheck(id: string): Promise<CameraCheck | null> {
  const { data, error } = await fcDb.from("facilities_camera_checks").select(CHECK_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}
export async function loadCheckLines(checkId: string): Promise<CameraCheckLine[]> {
  const { data, error } = await fcDb
    .from("facilities_camera_check_lines")
    .select("*, camera:facilities_cameras(*, recorder:facilities_recorders(code))")
    .eq("check_id", checkId)
    .order("sort_order");
  if (error) throw error;
  return data ?? [];
}
export async function loadCheckRecorders(checkId: string): Promise<CameraCheckRecorder[]> {
  const { data, error } = await fcDb
    .from("facilities_camera_check_recorders")
    .select("*, recorder:facilities_recorders(*)")
    .eq("check_id", checkId);
  if (error) throw error;
  return (data ?? []).sort((a: CameraCheckRecorder, b: CameraCheckRecorder) =>
    (a.recorder?.code ?? "").localeCompare(b.recorder?.code ?? ""));
}
export async function loadChecks(from: string, to: string): Promise<CameraCheck[]> {
  const { data, error } = await fcDb
    .from("facilities_camera_checks")
    .select(CHECK_SELECT)
    .gte("check_date", from)
    .lte("check_date", to)
    .order("check_date", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export const startCheck = (date?: string) => rpc<string>("facilities_camera_check_start", { p_date: date ?? null });
export const saveLine = (lineId: string, result: string, remark: string, photoPath: string) =>
  rpc("facilities_camera_check_save_line", { p_line_id: lineId, p_result: result, p_remark: remark || null, p_photo_path: photoPath || null });
export const saveRecorderLine = (lineId: string, data: Record<string, unknown>) =>
  rpc("facilities_camera_check_save_recorder", { p_line_id: lineId, p_data: data });
export const submitCheck = (id: string, remarks: string) => rpc("facilities_camera_check_submit", { p_check_id: id, p_remarks: remarks || null });
export const reviewCheck = (id: string, remarks: string) => rpc("facilities_camera_check_review", { p_check_id: id, p_remarks: remarks || null });
export const discardCheck = (id: string) => rpc("facilities_camera_check_discard", { p_check_id: id });
export const saveCamera = (id: string | null, data: Record<string, unknown>) => rpc<string>("facilities_camera_save", { p_id: id, p_data: data });
export const saveRecorder = (id: string | null, data: Record<string, unknown>) => rpc<string>("facilities_recorder_save", { p_id: id, p_data: data });

/** Day colour for the month calendar. */
export const checkDayTone = (c: CameraCheck | undefined, isPast: boolean) => {
  if (!c) return isPast ? "missed" : "none";
  if (c.status === "draft") return "draft";
  return c.fault_count > 0 || c.recorder_fault_count > 0 ? "faults" : "ok";
};
