// Office cleaning inspections (CLN-…): areas on a frequency, each with a
// checklist template; inspections score ok / not_ok / na; failed points
// become action items for the area's supervisor. The rules live in
// supabase/migrations/20261110120300_facilities_cleaning.sql — every write
// goes through its facilities_* functions; the tables are read-only here.

import { fcDb, rpc, type BadgeVariant } from "@/lib/facilities";

export type AreaFrequency = "daily" | "twice_daily" | "weekly" | "monthly";
export type InspectionShift = "morning" | "evening";
export type LineResult = "ok" | "not_ok" | "na";

export const FREQUENCY_META: Record<AreaFrequency, string> = {
  daily: "Daily",
  twice_daily: "Twice daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const RESULT_OPTIONS = [
  { value: "ok", label: "OK", tone: "ok" as const },
  { value: "not_ok", label: "Not OK", tone: "bad" as const },
  { value: "na", label: "N/A", tone: "na" as const },
];

export const INSPECTION_STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Draft", variant: "secondary" },
  submitted: { label: "Submitted", variant: "success" },
};
export const inspectionStatusMeta = (s: string) =>
  INSPECTION_STATUS_META[s] ?? { label: s, variant: "secondary" as BadgeVariant };

export const frequencyLabel = (a: Pick<Area, "frequency" | "due_weekday" | "due_day">) => {
  if (a.frequency === "weekly") return `Weekly · ${WEEKDAYS[a.due_weekday ?? 0] ?? ""}`;
  if (a.frequency === "monthly") return `Monthly · day ${a.due_day ?? 1}`;
  return FREQUENCY_META[a.frequency] ?? a.frequency;
};

export type Template = { id: string; name: string; is_active: boolean };
export type Checkpoint = { id: string; template_id: string; sort_order: number; text: string; is_active: boolean };

export type Area = {
  id: string;
  code: string;
  name: string;
  location: string | null;
  template_id: string;
  frequency: AreaFrequency;
  due_weekday: number | null;
  due_day: number | null;
  supervisor_id: string | null;
  is_active: boolean;
  template?: { name: string } | null;
  supervisor?: { full_name: string | null } | null;
};
export const AREA_SELECT =
  "id, code, name, location, template_id, frequency, due_weekday, due_day, supervisor_id, is_active, " +
  "template:facilities_cleaning_templates(name), supervisor:app_users!facilities_areas_supervisor_id_fkey(full_name)";

export type InspectionLine = {
  id: string;
  inspection_id: string;
  checkpoint_id: string | null;
  sort_order: number;
  text: string;
  result: LineResult | null;
  remark: string | null;
  photo_path: string | null;
};

export type Inspection = {
  id: string;
  inspection_number: string;
  area_id: string;
  inspection_date: string;
  shift: InspectionShift;
  status: "draft" | "submitted";
  inspector_id: string | null;
  score: number | null;
  ok_count: number;
  not_ok_count: number;
  na_count: number;
  remarks: string | null;
  submitted_at: string | null;
  created_at: string;
  area?: { code: string; name: string; location: string | null; frequency: AreaFrequency } | null;
  inspector?: { full_name: string | null } | null;
  lines?: InspectionLine[];
};
export const INSPECTION_SELECT =
  "id, inspection_number, area_id, inspection_date, shift, status, inspector_id, score, ok_count, not_ok_count, na_count, " +
  "remarks, submitted_at, created_at, area:facilities_areas(code, name, location, frequency), " +
  "inspector:app_users!facilities_inspections_inspector_id_fkey(full_name)";
export const INSPECTION_DETAIL_SELECT = INSPECTION_SELECT + ", lines:facilities_inspection_lines(*)";

export type CleaningAction = {
  id: string;
  inspection_id: string;
  line_id: string | null;
  area_id: string;
  text: string;
  assigned_to: string | null;
  due_date: string;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: string | null;
  close_note: string | null;
  after_photo_path: string | null;
  created_at: string;
  area?: { code: string; name: string } | null;
  inspection?: { inspection_number: string } | null;
  assignee?: { full_name: string | null } | null;
  line?: { photo_path: string | null; remark: string | null } | null;
};
export const ACTION_SELECT =
  "id, inspection_id, line_id, area_id, text, assigned_to, due_date, status, closed_by, closed_at, close_note, after_photo_path, created_at, " +
  "area:facilities_areas(code, name), inspection:facilities_inspections(inspection_number), " +
  "assignee:app_users!facilities_cleaning_actions_assigned_to_fkey(full_name), line:facilities_inspection_lines(photo_path, remark)";

export const sortedLines = (i: Inspection | null | undefined) =>
  [...(i?.lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);

export const liveScore = (lines: Pick<InspectionLine, "result">[]) => {
  const ok = lines.filter((l) => l.result === "ok").length;
  const bad = lines.filter((l) => l.result === "not_ok").length;
  return { ok, bad, na: lines.filter((l) => l.result === "na").length, score: ok + bad > 0 ? Math.round((100 * ok) / (ok + bad)) : null };
};

/** Which shifts an area needs on a date: [] when not due. */
export const dueShifts = (a: Pick<Area, "frequency" | "due_weekday" | "due_day" | "is_active">, date: Date): InspectionShift[] => {
  if (!a.is_active) return [];
  switch (a.frequency) {
    case "daily": return ["morning"];
    case "twice_daily": return ["morning", "evening"];
    case "weekly": return date.getDay() === (a.due_weekday ?? -1) ? ["morning"] : [];
    case "monthly": return date.getDate() === (a.due_day ?? -1) ? ["morning"] : [];
    default: return [];
  }
};

export type DueState = "done" | "due" | "overdue" | "partly" | "not_due";
export const DUE_META: Record<DueState, { label: string; variant: BadgeVariant }> = {
  done: { label: "Done", variant: "success" },
  partly: { label: "Morning done", variant: "info" },
  due: { label: "Due", variant: "warning" },
  overdue: { label: "Overdue", variant: "destructive" },
  not_due: { label: "Not due", variant: "secondary" },
};

/** Today's state of an area from the shifts it needs and the submitted shifts. Evening counts as overdue after 18:00. */
export const dueState = (needed: InspectionShift[], done: InspectionShift[], now: Date): DueState => {
  if (needed.length === 0) return "not_due";
  const missing = needed.filter((s) => !done.includes(s));
  if (missing.length === 0) return "done";
  if (needed.length === 2 && missing.length === 1 && missing[0] === "evening") {
    return now.getHours() >= 18 ? "overdue" : "partly";
  }
  const hour = now.getHours();
  if (missing.includes("morning") && hour >= 12) return "overdue";
  return "due";
};

export const loadAreas = async (activeOnly = false): Promise<Area[]> => {
  let q = fcDb.from("facilities_areas").select(AREA_SELECT).order("code");
  if (activeOnly) q = q.eq("is_active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
};

export const startInspection = (areaId: string, date: string | null, shift: InspectionShift) =>
  rpc<string>("facilities_inspection_start", { p_area_id: areaId, p_date: date, p_shift: shift });
export const saveLine = (lineId: string, result: LineResult | null, remark: string, photoPath: string) =>
  rpc<void>("facilities_inspection_save_line", { p_line_id: lineId, p_result: result, p_remark: remark, p_photo_path: photoPath });
export const submitInspection = (id: string, remarks: string) =>
  rpc<string>("facilities_inspection_submit", { p_id: id, p_remarks: remarks });
export const cancelDraft = (id: string) => rpc<void>("facilities_inspection_cancel_draft", { p_id: id });
export const closeAction = (id: string, note: string, afterPhotoPath: string) =>
  rpc<void>("facilities_cleaning_action_close", { p_id: id, p_note: note, p_after_photo_path: afterPhotoPath });
export const reassignAction = (id: string, user: string | null, dueDate: string | null) =>
  rpc<void>("facilities_cleaning_action_reassign", { p_id: id, p_user: user, p_due_date: dueDate });
export const saveTemplate = (id: string | null, data: Record<string, unknown>) =>
  rpc<string>("facilities_cleaning_template_save", { p_id: id, p_data: data });
export const saveCheckpoint = (id: string | null, data: Record<string, unknown>) =>
  rpc<string>("facilities_cleaning_checkpoint_save", { p_id: id, p_data: data });
export const saveArea = (id: string | null, data: Record<string, unknown>) =>
  rpc<string>("facilities_area_save", { p_id: id, p_data: data });
