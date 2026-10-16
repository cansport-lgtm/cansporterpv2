// QA Dashboard export (Excel + PDF).
//
// Every chart on the QA Dashboard is an aggregate of the same underlying
// qa_inspections rows, so the export fetches those rows once for a single date
// range and derives every table from them. That keeps all sheets consistent
// with each other (the Process sheet total always equals the Inspections sheet
// row count, etc.).
//
// Excel layout is built for analysis: every data sheet has its header in row 1,
// one record per row, numbers stored as numbers and dates as real dates, and an
// autofilter on the header, so a sheet can be turned into a pivot table as-is.
// Report-style context (title, period, KPIs, sheet guide) lives only on the
// "Summary" sheet.

import { format, eachDayOfInterval, parseISO } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { PdfToken, ascii, padLeft, padRight, renderTextPdf } from "./pdfBuilder";

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export interface QAPlanItemExport {
  department: string;
  process: string;
  grade: string;
  assignedTo: string;
  target: number;
  completed: number;
  progress: number;
}

export interface QADashboardExportInput {
  fromDate: Date;
  toDate: Date;
  keyProcessCodes: string[];
  todayPlanDate: string;
  todayPlanItems: QAPlanItemExport[];
}

interface InspectionRow {
  id: string;
  inspectionNumber: string;
  date: string; // yyyy-MM-dd
  createdAt: Date | null;
  hour: number | null;
  shift: string;
  department: string;
  processCode: string;
  process: string;
  processSeq: number | null;
  isKeyProcess: boolean;
  grade: string;
  createdBy: string;
  createdById: string;
  role: "QA Officer" | "Machine Operator" | "";
  inspector: string;
  result: string; // Pass / Fail / Hold / ""
  status: string;
  tagTracking: string;
  reviewedBy: string;
  reviewedAt: Date | null;
  remarks: string;
  readingsCount: number;
  outOfSpecCount: number;
}

interface ReadingRow {
  inspectionNumber: string;
  date: string;
  process: string;
  grade: string;
  shift: string;
  inspectionResult: string;
  parameter: string;
  parameterType: string;
  unit: string;
  min: number | null;
  max: number | null;
  valueNumber: number | null;
  valueText: string;
  valueDisplay: string;
  withinSpec: string; // Yes / No / ""
  remarks: string;
}

interface NcrRow {
  ncrNumber: string;
  date: string;
  severity: string;
  status: string;
  isOpen: boolean;
  department: string;
  grade: string;
  inspectionNumber: string;
  description: string;
  immediateAction: string;
  rootCause: string;
  qtyAffected: number | null;
  raisedBy: string;
  assignedTo: string;
  closedAt: Date | null;
}

interface CapaRow {
  capaNumber: string;
  type: string;
  status: string;
  isPending: boolean;
  ncrNumber: string;
  description: string;
  actionPlan: string;
  responsible: string;
  targetDate: string;
  completionDate: string;
  overdue: string;
  createdAt: Date | null;
}

interface ProcessMeta {
  id: string;
  name: string;
  code: string;
  seq: number | null;
}

export interface QADashboardExportData {
  input: QADashboardExportInput;
  fromStr: string;
  toStr: string;
  generatedAt: Date;
  processes: ProcessMeta[];
  inspections: InspectionRow[];
  readings: ReadingRow[];
  ncrs: NcrRow[];
  capas: CapaRow[];
}

const PAGE = 1000;

// PostgREST caps responses at 1000 rows, so page through with .range().
async function fetchAll<T>(build: () => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data || []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const resultLabel = (r: string | null | undefined) =>
  r === "pass" ? "Pass" : r === "fail" ? "Fail" : r === "hold" ? "Hold" : "";

const titleCase = (s: string | null | undefined) =>
  s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : "";

const toDate = (s: string | null | undefined) => (s ? new Date(s) : null);

export async function fetchQADashboardExportData(
  input: QADashboardExportInput
): Promise<QADashboardExportData> {
  const fromStr = format(input.fromDate, "yyyy-MM-dd");
  const toStr = format(input.toDate, "yyyy-MM-dd");

  const [processesRaw, inspectionsRaw, ncrsRaw, capasRaw] = await Promise.all([
    fetchAll<any>(() =>
      (supabase.from("qa_processes") as any)
        .select("id, name, code, sequence_order")
        .eq("is_active", true)
        .order("sequence_order", { ascending: true })
        .order("id", { ascending: true })
    ),
    fetchAll<any>(() =>
      (supabase.from("qa_inspections") as any)
        .select(
          `id, inspection_number, inspection_date, created_at, shift, result, status, remarks,
           tag_tracking_number, reviewed_at, created_by,
           qa_processes(name, code, sequence_order),
           grades(name),
           production_departments(name),
           creator:app_users!qa_inspections_created_by_fkey(full_name),
           inspector:app_users!qa_inspections_inspector_id_fkey(full_name),
           reviewer:app_users!qa_inspections_reviewed_by_fkey(full_name)`
        )
        .gte("inspection_date", fromStr)
        .lte("inspection_date", toStr)
        .order("inspection_date", { ascending: true })
        .order("id", { ascending: true })
    ),
    fetchAll<any>(() =>
      (supabase.from("qa_ncr") as any)
        .select(
          `ncr_number, ncr_date, severity, status, description, immediate_action, root_cause,
           quantity_affected, closed_at,
           production_departments(name),
           grades(name),
           qa_inspections(inspection_number),
           raiser:app_users!qa_ncr_raised_by_fkey(full_name),
           assignee:app_users!qa_ncr_assigned_to_fkey(full_name)`
        )
        .gte("ncr_date", fromStr)
        .lte("ncr_date", toStr)
        .order("ncr_date", { ascending: true })
        .order("id", { ascending: true })
    ),
    fetchAll<any>(() =>
      (supabase.from("qa_capa") as any)
        .select(
          `capa_number, capa_type, status, description, action_plan, responsible_person,
           target_date, completion_date, created_at, qa_ncr(ncr_number)`
        )
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
    ),
  ]);

  // Roles: a creator with an "operator" role is a Machine Operator, everyone
  // else is a QA Officer (same split the dashboard charts use).
  const creatorIds = [...new Set(inspectionsRaw.map((i) => i.created_by).filter(Boolean))] as string[];
  const operatorIds = new Set<string>();
  for (const ids of chunk(creatorIds, 200)) {
    const { data, error } = await supabase.from("user_roles").select("user_id, role").in("user_id", ids);
    if (error) throw error;
    (data || []).forEach((r: any) => {
      if (r.role === "operator") operatorIds.add(r.user_id);
    });
  }

  // Readings, fetched in chunks of inspection ids.
  const readingsRaw: any[] = [];
  for (const ids of chunk(inspectionsRaw.map((i) => i.id), 150)) {
    const rows = await fetchAll<any>(() =>
      (supabase.from("qa_inspection_readings") as any)
        .select(
          "inspection_id, value_number, value_text, value_boolean, is_within_spec, remarks, qa_process_parameters(parameter_name, parameter_type, unit, min_value, max_value, sequence_order)"
        )
        .in("inspection_id", ids)
        .order("id", { ascending: true })
    );
    readingsRaw.push(...rows);
  }

  const readingStats = new Map<string, { count: number; out: number }>();
  readingsRaw.forEach((r) => {
    const s = readingStats.get(r.inspection_id) || { count: 0, out: 0 };
    s.count += 1;
    if (r.is_within_spec === false) s.out += 1;
    readingStats.set(r.inspection_id, s);
  });

  const keyCodes = new Set(input.keyProcessCodes);

  const inspections: InspectionRow[] = inspectionsRaw.map((i) => {
    const createdAt = toDate(i.created_at);
    const stats = readingStats.get(i.id);
    return {
      id: i.id,
      inspectionNumber: i.inspection_number || "",
      date: i.inspection_date,
      createdAt,
      hour: createdAt ? createdAt.getHours() : null,
      shift: i.shift || "",
      department: i.production_departments?.name || "",
      processCode: i.qa_processes?.code || "",
      process: i.qa_processes?.name || "Unknown",
      processSeq: i.qa_processes?.sequence_order ?? null,
      isKeyProcess: keyCodes.has(i.qa_processes?.code || ""),
      grade: i.grades?.name || "",
      createdBy: i.creator?.full_name || "",
      createdById: i.created_by || "",
      role: i.created_by ? (operatorIds.has(i.created_by) ? "Machine Operator" : "QA Officer") : "",
      inspector: i.inspector?.full_name || "",
      result: resultLabel(i.result),
      status: titleCase(i.status),
      tagTracking: i.tag_tracking_number || "",
      reviewedBy: i.reviewer?.full_name || "",
      reviewedAt: toDate(i.reviewed_at),
      remarks: i.remarks || "",
      readingsCount: stats?.count || 0,
      outOfSpecCount: stats?.out || 0,
    };
  });

  const inspById = new Map(inspections.map((i) => [i.id, i]));
  const readings: ReadingRow[] = readingsRaw
    .map((r) => {
      const insp = inspById.get(r.inspection_id);
      const p = r.qa_process_parameters || {};
      const type = p.parameter_type || "";
      let display = "";
      if (type === "boolean") display = r.value_boolean == null ? "" : r.value_boolean ? "Yes" : "No";
      else if (type === "number") display = r.value_number == null ? "" : `${r.value_number}${p.unit ? ` ${p.unit}` : ""}`;
      else display = r.value_text || "";
      return {
        sortSeq: p.sequence_order ?? 999,
        row: {
          inspectionNumber: insp?.inspectionNumber || "",
          date: insp?.date || "",
          process: insp?.process || "",
          grade: insp?.grade || "",
          shift: insp?.shift || "",
          inspectionResult: insp?.result || "",
          parameter: p.parameter_name || "",
          parameterType: titleCase(type),
          unit: p.unit || "",
          min: p.min_value ?? null,
          max: p.max_value ?? null,
          valueNumber: r.value_number ?? null,
          valueText: type === "boolean" ? display : r.value_text || "",
          valueDisplay: display,
          withinSpec: r.is_within_spec == null ? "" : r.is_within_spec ? "Yes" : "No",
          remarks: r.remarks || "",
        } as ReadingRow,
      };
    })
    .sort(
      (a, b) =>
        a.row.date.localeCompare(b.row.date) ||
        a.row.inspectionNumber.localeCompare(b.row.inspectionNumber) ||
        a.sortSeq - b.sortSeq
    )
    .map((x) => x.row);

  const ncrs: NcrRow[] = ncrsRaw.map((n) => ({
    ncrNumber: n.ncr_number || "",
    date: n.ncr_date,
    severity: titleCase(n.severity),
    status: titleCase(n.status),
    isOpen: n.status !== "closed",
    department: n.production_departments?.name || "",
    grade: n.grades?.name || "",
    inspectionNumber: n.qa_inspections?.inspection_number || "",
    description: n.description || "",
    immediateAction: n.immediate_action || "",
    rootCause: n.root_cause || "",
    qtyAffected: n.quantity_affected ?? null,
    raisedBy: n.raiser?.full_name || "",
    assignedTo: n.assignee?.full_name || "",
    closedAt: toDate(n.closed_at),
  }));

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const capas: CapaRow[] = capasRaw.map((c) => {
    const isPending = c.status !== "closed" && c.status !== "approved";
    return {
      capaNumber: c.capa_number || "",
      type: titleCase(c.capa_type),
      status: titleCase(c.status),
      isPending,
      ncrNumber: c.qa_ncr?.ncr_number || "",
      description: c.description || "",
      actionPlan: c.action_plan || "",
      responsible: c.responsible_person || "",
      targetDate: c.target_date || "",
      completionDate: c.completion_date || "",
      overdue: isPending && c.target_date && c.target_date < todayStr ? "Yes" : "No",
      createdAt: toDate(c.created_at),
    };
  });

  return {
    input,
    fromStr,
    toStr,
    generatedAt: new Date(),
    processes: processesRaw.map((p) => ({ id: p.id, name: p.name, code: p.code || "", seq: p.sequence_order ?? null })),
    inspections,
    readings,
    ncrs,
    capas,
  };
}

// ---------------------------------------------------------------------------
// Aggregations (shared by Excel and PDF)
// ---------------------------------------------------------------------------

interface Counts {
  total: number;
  pass: number;
  fail: number;
  hold: number;
}

const emptyCounts = (): Counts => ({ total: 0, pass: 0, fail: 0, hold: 0 });

function add(c: Counts, result: string) {
  c.total += 1;
  if (result === "Pass") c.pass += 1;
  else if (result === "Fail") c.fail += 1;
  else if (result === "Hold") c.hold += 1;
}

// Percent rounded to 1 decimal, as a number (e.g. 93.4).
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 1000) / 10 : 0);

function groupCounts<K>(rows: InspectionRow[], key: (r: InspectionRow) => K) {
  const map = new Map<K, Counts>();
  rows.forEach((r) => {
    const k = key(r);
    if (!map.has(k)) map.set(k, emptyCounts());
    add(map.get(k)!, r.result);
  });
  return map;
}

function totals(rows: InspectionRow[]): Counts {
  const c = emptyCounts();
  rows.forEach((r) => add(c, r.result));
  return c;
}

function processSummary(d: QADashboardExportData) {
  const byName = groupCounts(d.inspections, (r) => r.process);
  const keyCodes = new Set(d.input.keyProcessCodes);
  const rows = d.processes.map((p) => ({
    seq: p.seq,
    code: p.code,
    process: p.name,
    isKey: keyCodes.has(p.code),
    ...(byName.get(p.name) || emptyCounts()),
  }));
  // Inspections on processes that are no longer active still belong in the totals.
  const known = new Set(d.processes.map((p) => p.name));
  byName.forEach((c, name) => {
    if (!known.has(name)) {
      const sample = d.inspections.find((i) => i.process === name);
      rows.push({ seq: sample?.processSeq ?? null, code: sample?.processCode || "", process: name, isKey: !!sample?.isKeyProcess, ...c });
    }
  });
  return rows.sort((a, b) => (a.seq ?? 999) - (b.seq ?? 999) || a.process.localeCompare(b.process));
}

function gradeSummary(d: QADashboardExportData) {
  return [...groupCounts(d.inspections, (r) => r.grade || "(No grade)").entries()]
    .map(([grade, c]) => ({ grade, ...c }))
    .sort((a, b) => b.total - a.total || a.grade.localeCompare(b.grade));
}

function gradeProcessSummary(d: QADashboardExportData) {
  return [...groupCounts(d.inspections, (r) => `${r.grade || "(No grade)"}\u0000${r.process}\u0000${r.processSeq ?? 999}`).entries()]
    .map(([k, c]) => {
      const [grade, process, seq] = k.split("\u0000");
      return { grade, process, seq: Number(seq), ...c };
    })
    .sort((a, b) => a.grade.localeCompare(b.grade) || a.seq - b.seq || a.process.localeCompare(b.process));
}

function dailyTrend(d: QADashboardExportData) {
  const byDate = groupCounts(d.inspections, (r) => r.date);
  return eachDayOfInterval({ start: parseISO(d.fromStr), end: parseISO(d.toStr) }).map((day) => {
    const key = format(day, "yyyy-MM-dd");
    return { date: key, ...(byDate.get(key) || emptyCounts()) };
  });
}

function personSummary(d: QADashboardExportData) {
  const rows = d.inspections.filter((r) => r.createdBy);
  return [...groupCounts(rows, (r) => `${r.createdBy}\u0000${r.role}`).entries()]
    .map(([k, c]) => {
      const [name, role] = k.split("\u0000");
      const mine = rows.filter((r) => r.createdBy === name && r.role === role);
      return {
        name,
        role,
        processes: new Set(mine.map((r) => r.process)).size,
        days: new Set(mine.map((r) => r.date)).size,
        ...c,
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role) || b.total - a.total || a.name.localeCompare(b.name));
}

function personProcessSummary(d: QADashboardExportData) {
  const rows = d.inspections.filter((r) => r.createdBy);
  return [...groupCounts(rows, (r) => `${r.createdBy}\u0000${r.role}\u0000${r.process}\u0000${r.processSeq ?? 999}`).entries()]
    .map(([k, c]) => {
      const [name, role, process, seq] = k.split("\u0000");
      return { name, role, process, seq: Number(seq), ...c };
    })
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name) || a.seq - b.seq);
}

function hourlyActivity(d: QADashboardExportData) {
  const rows = d.inspections.filter((r) => r.createdBy && r.hour != null);
  return [...groupCounts(rows, (r) => `${r.hour}\u0000${r.createdBy}\u0000${r.role}`).entries()]
    .map(([k, c]) => {
      const [hour, name, role] = k.split("\u0000");
      return { hour: Number(hour), name, role, ...c };
    })
    .sort((a, b) => a.hour - b.hour || a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

// Person x hour matrix, mirroring the "Time vs Inspections" bar charts.
function hourlyMatrix(d: QADashboardExportData, role: "QA Officer" | "Machine Operator") {
  const rows = d.inspections.filter((r) => r.role === role && r.createdBy && r.hour != null);
  const hours = [...new Set(rows.map((r) => r.hour as number))].sort((a, b) => a - b);
  const people = [...new Set(rows.map((r) => r.createdBy))].sort();
  const counts = new Map<string, number>();
  rows.forEach((r) => {
    const k = `${r.createdBy}|${r.hour}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return {
    hours,
    rows: people.map((name) => {
      const perHour = hours.map((h) => counts.get(`${name}|${h}`) || 0);
      return { name, perHour, total: perHour.reduce((s, n) => s + n, 0) };
    }),
    hourTotals: hours.map((h) => rows.filter((r) => r.hour === h).length),
  };
}

const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;

function ncrSeverity(d: QADashboardExportData) {
  const order = ["Low", "Medium", "High", "Critical"];
  const sevs = [...new Set([...order, ...d.ncrs.map((n) => n.severity || "(None)")])];
  return sevs
    .map((s) => {
      const list = d.ncrs.filter((n) => (n.severity || "(None)") === s);
      return { severity: s, total: list.length, open: list.filter((n) => n.isOpen).length, closed: list.filter((n) => !n.isOpen).length };
    })
    .filter((r) => r.total > 0 || order.includes(r.severity));
}

function periodLabel(d: QADashboardExportData) {
  const f = format(d.input.fromDate, "dd MMM yyyy");
  const t = format(d.input.toDate, "dd MMM yyyy");
  return f === t ? f : `${f} to ${t}`;
}

export function exportFileBase(d: QADashboardExportData) {
  return `QA-Dashboard_${d.fromStr}${d.fromStr === d.toStr ? "" : `_to_${d.toStr}`}`;
}

// ---------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------

type Cell = string | number | boolean | Date | null;

interface SheetSpec {
  name: string;
  description: string;
  headers: string[];
  rows: Cell[][];
  widths?: number[];
  // Row appended after the data (e.g. TOTAL). Kept out of the autofilter range.
  footer?: Cell[];
}

const dateOnly = (s: string) => (s ? parseISO(s) : null);
const yn = (b: boolean) => (b ? "Yes" : "No");

function buildSheets(d: QADashboardExportData): SheetSpec[] {
  const t = totals(d.inspections);
  const sheets: SheetSpec[] = [];

  // 1. Inspections (fact table)
  sheets.push({
    name: "Inspections",
    description: "One row per inspection with every attribute. Best sheet for pivot tables (Pass/Fail/Hold columns are 1/0 so they can be summed).",
    headers: [
      "Inspection #", "Inspection Date", "Year", "Month", "Week", "Day", "Created At", "Hour",
      "Shift", "Department", "Process Code", "Process", "Process Seq", "Key Process",
      "Grade", "Created By", "Role", "Inspector", "Result", "Pass", "Fail", "Hold",
      "Status", "Tag Tracking #", "Reviewed By", "Reviewed At", "Readings", "Out of Spec Readings", "Remarks",
    ],
    widths: [16, 13, 6, 9, 6, 6, 18, 7, 8, 18, 10, 28, 9, 10, 18, 20, 16, 20, 7, 5, 5, 5, 11, 15, 20, 18, 9, 11, 40],
    rows: d.inspections.map((r) => {
      const day = parseISO(r.date);
      return [
        r.inspectionNumber, day, Number(format(day, "yyyy")), format(day, "yyyy-MM"), Number(format(day, "I")), format(day, "EEE"),
        r.createdAt, r.hour == null ? null : hourLabel(r.hour),
        r.shift, r.department, r.processCode, r.process, r.processSeq, yn(r.isKeyProcess),
        r.grade, r.createdBy, r.role, r.inspector, r.result,
        r.result === "Pass" ? 1 : 0, r.result === "Fail" ? 1 : 0, r.result === "Hold" ? 1 : 0,
        r.status, r.tagTracking, r.reviewedBy, r.reviewedAt, r.readingsCount, r.outOfSpecCount, r.remarks,
      ];
    }),
  });

  // 2. Readings (fact table)
  sheets.push({
    name: "Readings",
    description: "One row per parameter reading of each inspection (the details shown under View Details), with spec limits and in-spec flag.",
    headers: [
      "Inspection #", "Inspection Date", "Process", "Grade", "Shift", "Inspection Result",
      "Parameter", "Parameter Type", "Unit", "Min", "Max", "Value (Number)", "Value (Text)", "Value", "Within Spec", "Remarks",
    ],
    widths: [16, 13, 28, 18, 8, 10, 28, 12, 8, 8, 8, 12, 16, 18, 10, 30],
    rows: d.readings.map((r) => [
      r.inspectionNumber, dateOnly(r.date), r.process, r.grade, r.shift, r.inspectionResult,
      r.parameter, r.parameterType, r.unit, r.min, r.max, r.valueNumber, r.valueText, r.valueDisplay, r.withinSpec, r.remarks,
    ]),
  });

  // 3. Process summary
  const procs = processSummary(d);
  sheets.push({
    name: "By Process",
    description: "Process-wise / Key Process results: Pass/Fail/Hold per process in sequence order (all active processes, including ones with zero inspections).",
    headers: ["Seq", "Process Code", "Process", "Key Process", "Total", "Pass", "Fail", "Hold", "Pass %", "Fail %", "Hold %"],
    widths: [6, 12, 30, 11, 8, 8, 8, 8, 8, 8, 8],
    rows: procs.map((p) => [p.seq, p.code, p.process, yn(p.isKey), p.total, p.pass, p.fail, p.hold, pct(p.pass, p.total), pct(p.fail, p.total), pct(p.hold, p.total)]),
    footer: ["", "", "TOTAL", "", t.total, t.pass, t.fail, t.hold, pct(t.pass, t.total), pct(t.fail, t.total), pct(t.hold, t.total)],
  });

  // 4. Grade summary
  sheets.push({
    name: "By Grade",
    description: "Grade-wise inspection results.",
    headers: ["Grade", "Processes Inspected", "Total", "Pass", "Fail", "Hold", "Pass %", "Fail %", "Hold %"],
    widths: [22, 12, 8, 8, 8, 8, 8, 8, 8],
    rows: gradeSummary(d).map((g) => [
      g.grade, new Set(d.inspections.filter((i) => (i.grade || "(No grade)") === g.grade).map((i) => i.process)).size,
      g.total, g.pass, g.fail, g.hold, pct(g.pass, g.total), pct(g.fail, g.total), pct(g.hold, g.total),
    ]),
    footer: ["TOTAL", "", t.total, t.pass, t.fail, t.hold, pct(t.pass, t.total), pct(t.fail, t.total), pct(t.hold, t.total)],
  });

  // 5. Grade x Process
  sheets.push({
    name: "By Grade & Process",
    description: "Grade-wise results broken down by process (the per-grade pie breakdown).",
    headers: ["Grade", "Process", "Total", "Pass", "Fail", "Hold", "Pass %"],
    widths: [22, 30, 8, 8, 8, 8, 8],
    rows: gradeProcessSummary(d).map((g) => [g.grade, g.process, g.total, g.pass, g.fail, g.hold, pct(g.pass, g.total)]),
  });

  // 6. Daily trend
  const trend = dailyTrend(d);
  sheets.push({
    name: "Daily Trend",
    description: "Inspections per day for every date in the period (zero days included) - ready for a line chart.",
    headers: ["Date", "Day", "Total", "Pass", "Fail", "Hold", "Pass %"],
    widths: [13, 6, 8, 8, 8, 8, 8],
    rows: trend.map((r) => {
      const day = parseISO(r.date);
      return [day, format(day, "EEE"), r.total, r.pass, r.fail, r.hold, pct(r.pass, r.total)];
    }),
    footer: ["TOTAL", "", t.total, t.pass, t.fail, t.hold, pct(t.pass, t.total)],
  });

  // 7. People
  sheets.push({
    name: "By Person",
    description: "QA Officers and Machine Operators: inspections done and their results.",
    headers: ["Name", "Role", "Days Active", "Processes", "Total", "Pass", "Fail", "Hold", "Pass %", "Avg / Day"],
    widths: [24, 16, 10, 10, 8, 8, 8, 8, 8, 9],
    rows: personSummary(d).map((p) => [
      p.name, p.role, p.days, p.processes, p.total, p.pass, p.fail, p.hold, pct(p.pass, p.total),
      p.days > 0 ? Math.round((p.total / p.days) * 10) / 10 : 0,
    ]),
  });

  sheets.push({
    name: "By Person & Process",
    description: "Operator / QA Officer process-wise inspections (the per-person pie charts).",
    headers: ["Name", "Role", "Process", "Total", "Pass", "Fail", "Hold", "Pass %"],
    widths: [24, 16, 30, 8, 8, 8, 8, 8],
    rows: personProcessSummary(d).map((p) => [p.name, p.role, p.process, p.total, p.pass, p.fail, p.hold, pct(p.pass, p.total)]),
  });

  // 8. Hourly (long + matrices)
  sheets.push({
    name: "Hourly Activity",
    description: "Time vs Inspections in long format: one row per hour per person (hour is from the inspection's entry time).",
    headers: ["Hour", "Name", "Role", "Inspections", "Pass", "Fail", "Hold"],
    widths: [7, 24, 16, 11, 8, 8, 8],
    rows: hourlyActivity(d).map((h) => [hourLabel(h.hour), h.name, h.role, h.total, h.pass, h.fail, h.hold]),
  });

  (["QA Officer", "Machine Operator"] as const).forEach((role) => {
    const m = hourlyMatrix(d, role);
    sheets.push({
      name: role === "QA Officer" ? "Hourly - QA Officers" : "Hourly - Operators",
      description: `${role === "QA Officer" ? "QA Officers" : "Machine Operators"} - Time vs Inspections chart as a table: hours as rows, people as columns.`,
      headers: ["Hour", ...m.rows.map((r) => r.name), "Total"],
      widths: [7, ...m.rows.map((r) => Math.max(10, Math.min(24, r.name.length + 2))), 8],
      rows: m.hours.map((h, hi) => [hourLabel(h), ...m.rows.map((r) => r.perHour[hi]), m.hourTotals[hi]]),
      footer: m.rows.length ? ["TOTAL", ...m.rows.map((r) => r.total), m.rows.reduce((s, r) => s + r.total, 0)] : undefined,
    });
  });

  // 9. NCRs
  const sev = ncrSeverity(d);
  sheets.push({
    name: "NCR Severity",
    description: "NCR Severity Distribution for NCRs raised in the period.",
    headers: ["Severity", "Total", "Open", "Closed"],
    widths: [12, 8, 8, 8],
    rows: sev.map((s) => [s.severity, s.total, s.open, s.closed]),
    footer: ["TOTAL", d.ncrs.length, d.ncrs.filter((n) => n.isOpen).length, d.ncrs.filter((n) => !n.isOpen).length],
  });

  sheets.push({
    name: "NCRs",
    description: "Every NCR raised in the period.",
    headers: [
      "NCR #", "NCR Date", "Month", "Severity", "Status", "Open", "Department", "Grade", "Inspection #",
      "Quantity Affected", "Description", "Immediate Action", "Root Cause", "Raised By", "Assigned To", "Closed At",
    ],
    widths: [14, 12, 9, 10, 11, 6, 18, 18, 16, 10, 40, 30, 30, 20, 20, 18],
    rows: d.ncrs.map((n) => [
      n.ncrNumber, dateOnly(n.date), n.date.slice(0, 7), n.severity, n.status, yn(n.isOpen), n.department, n.grade, n.inspectionNumber,
      n.qtyAffected, n.description, n.immediateAction, n.rootCause, n.raisedBy, n.assignedTo, n.closedAt,
    ]),
  });

  // 10. CAPAs
  sheets.push({
    name: "CAPAs",
    description: "All CAPAs (the Pending CAPAs card counts every CAPA not Closed/Approved).",
    headers: [
      "CAPA #", "Type", "Status", "Pending", "Overdue", "NCR #", "Responsible", "Created At",
      "Target Date", "Completion Date", "Description", "Action Plan",
    ],
    widths: [14, 12, 11, 8, 8, 14, 20, 18, 12, 14, 40, 40],
    rows: d.capas.map((c) => [
      c.capaNumber, c.type, c.status, yn(c.isPending), c.overdue, c.ncrNumber, c.responsible, c.createdAt,
      dateOnly(c.targetDate), dateOnly(c.completionDate), c.description, c.actionPlan,
    ]),
  });

  // 11. Today's plan
  sheets.push({
    name: "Today's Plan",
    description: `Today's Quality Plan (${d.input.todayPlanDate}) - target vs completed inspections. Not affected by the export period.`,
    headers: ["Plan Date", "Department", "Process", "Grade", "Assigned To", "Target", "Completed", "Remaining", "Progress %"],
    widths: [12, 18, 28, 18, 20, 8, 10, 10, 10],
    rows: d.input.todayPlanItems.map((p) => [
      dateOnly(d.input.todayPlanDate), p.department, p.process, p.grade, p.assignedTo,
      p.target, p.completed, Math.max(0, p.target - p.completed), p.progress,
    ]),
  });

  return sheets;
}

function summaryAoa(d: QADashboardExportData, sheets: SheetSpec[]): Cell[][] {
  const t = totals(d.inspections);
  const openNcrs = d.ncrs.filter((n) => n.isOpen).length;
  const pendingCapas = d.capas.filter((c) => c.isPending).length;
  const outOfSpec = d.readings.filter((r) => r.withinSpec === "No").length;
  const metrics: [string, Cell, string][] = [
    ["Total Inspections", t.total, "Inspections dated within the period"],
    ["Passed", t.pass, ""],
    ["Failed", t.fail, ""],
    ["Hold", t.hold, ""],
    ["Pass Rate %", pct(t.pass, t.total), "Passed / Total x 100"],
    ["Fail Rate %", pct(t.fail, t.total), "Failed / Total x 100"],
    ["Processes Inspected", new Set(d.inspections.map((i) => i.process)).size, ""],
    ["Grades Inspected", new Set(d.inspections.map((i) => i.grade).filter(Boolean)).size, ""],
    ["QA Officers Active", new Set(d.inspections.filter((i) => i.role === "QA Officer").map((i) => i.createdBy)).size, ""],
    ["Machine Operators Active", new Set(d.inspections.filter((i) => i.role === "Machine Operator").map((i) => i.createdBy)).size, ""],
    ["Parameter Readings", d.readings.length, ""],
    ["Out of Spec Readings", outOfSpec, ""],
    ["NCRs Raised", d.ncrs.length, "NCR date within the period"],
    ["Open NCRs", openNcrs, "Raised in the period and not closed"],
    ["Pending CAPAs", pendingCapas, "All CAPAs not Closed/Approved (any date)"],
  ];
  return [
    ["QA Dashboard Export"],
    ["Period", periodLabel(d)],
    ["From", parseISO(d.fromStr)],
    ["To", parseISO(d.toStr)],
    ["Generated At", d.generatedAt],
    [],
    ["Metric", "Value", "Notes"],
    ...metrics,
    [],
    ["Sheet", "Rows", "Contents"],
    ...sheets.map((s) => [s.name, s.rows.length, s.description] as Cell[]),
  ];
}

const DATE_FMT = "yyyy-mm-dd";
const DATETIME_FMT = "yyyy-mm-dd hh:mm";

// Give date cells a proper Excel number format: date-only if midnight, else date+time.
function formatDateCells(XLSX: any, ws: any) {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "d" && cell.v instanceof Date) {
        const v = cell.v as Date;
        const hasTime = v.getHours() || v.getMinutes() || v.getSeconds();
        cell.z = hasTime ? DATETIME_FMT : DATE_FMT;
      }
    }
  }
}

export async function downloadQADashboardExcel(d: QADashboardExportData) {
  const XLSX = await import("xlsx");
  const sheets = buildSheets(d);
  const wb = XLSX.utils.book_new();

  const summaryWs = XLSX.utils.aoa_to_sheet(summaryAoa(d, sheets), { cellDates: true });
  summaryWs["!cols"] = [{ wch: 26 }, { wch: 24 }, { wch: 110 }];
  formatDateCells(XLSX, summaryWs);
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");

  sheets.forEach((s) => {
    const aoa: Cell[][] = [s.headers, ...s.rows];
    if (s.footer) aoa.push(s.footer);
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
    if (s.widths) ws["!cols"] = s.widths.map((w) => ({ wch: w }));
    // Autofilter covers header + data rows only, so the TOTAL row never gets
    // sorted into the data.
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, s.rows.length), c: s.headers.length - 1 } }),
    };
    formatDateCells(XLSX, ws);
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });

  XLSX.writeFile(wb, `${exportFileBase(d)}.xlsx`, { cellDates: true, compression: true });
}

// ---------------------------------------------------------------------------
// PDF (landscape A4, fixed-width tables)
// ---------------------------------------------------------------------------

const PAGE_W = 842;
const PAGE_H = 595;
const MARGIN_X = 28;
const MARGIN_TOP = 32;
const MARGIN_BOTTOM = 32;
const BODY = 7.5;
const LINE_H = 10;
const PAGE_OPTS = { pageW: PAGE_W, pageH: PAGE_H, marginX: MARGIN_X, marginTop: MARGIN_TOP, lineH: LINE_H };
const MAX_LINES = Math.floor((PAGE_H - MARGIN_TOP - MARGIN_BOTTOM) / LINE_H);
// Courier glyphs are 0.6em wide.
const MAX_CHARS = Math.floor((PAGE_W - 2 * MARGIN_X) / (BODY * 0.6));

const L = (text: string, bold = false, size = BODY): PdfToken => ({ text: ascii(text), bold, size });
const BLANK = L("");

interface Col {
  title: string;
  width: number;
  align?: "left" | "right";
}

function tableLines(cols: Col[], rows: (string | number | null)[][], footer?: (string | number | null)[]): PdfToken[] {
  const fmt = (cells: (string | number | null)[]) =>
    cols
      .map((c, i) => {
        const v = cells[i] == null ? "" : String(cells[i]);
        return c.align === "right" ? padLeft(v, c.width - 1) + " " : padRight(v, c.width);
      })
      .join("")
      .slice(0, MAX_CHARS);
  const ruleW = Math.min(MAX_CHARS, cols.reduce((s, c) => s + c.width, 0));
  const out: PdfToken[] = [L(fmt(cols.map((c) => c.title)), true), L("-".repeat(ruleW))];
  if (rows.length === 0) out.push(L("  No data for this period"));
  rows.forEach((r) => out.push(L(fmt(r))));
  if (footer) {
    out.push(L("-".repeat(ruleW)));
    out.push(L(fmt(footer), true));
  }
  return out;
}

const section = (title: string) => [BLANK, L(title.toUpperCase(), true, 10)];
const p1 = (n: number) => n.toFixed(1);

export function buildQADashboardPdf(d: QADashboardExportData): Blob {
  const t = totals(d.inspections);
  const tokens: PdfToken[] = [];

  tokens.push(L("QA DASHBOARD REPORT", true, 14));
  tokens.push(L(`Period: ${periodLabel(d)}    Generated: ${format(d.generatedAt, "dd MMM yyyy HH:mm")}`));

  // Summary KPIs
  tokens.push(...section("Summary"));
  tokens.push(
    ...tableLines(
      [{ title: "Metric", width: 30 }, { title: "Value", width: 12, align: "right" }],
      [
        ["Total Inspections", t.total],
        ["Passed", t.pass],
        ["Failed", t.fail],
        ["Hold", t.hold],
        ["Pass Rate %", p1(pct(t.pass, t.total))],
        ["NCRs Raised (period)", d.ncrs.length],
        ["Open NCRs (period)", d.ncrs.filter((n) => n.isOpen).length],
        ["Pending CAPAs (all)", d.capas.filter((c) => c.isPending).length],
        ["Out of Spec Readings", d.readings.filter((r) => r.withinSpec === "No").length],
      ]
    )
  );

  const countCols = (first: Col[]): Col[] => [
    ...first,
    { title: "Total", width: 8, align: "right" },
    { title: "Pass", width: 8, align: "right" },
    { title: "Fail", width: 8, align: "right" },
    { title: "Hold", width: 8, align: "right" },
    { title: "Pass %", width: 8, align: "right" },
  ];
  const countCells = (c: Counts) => [c.total, c.pass, c.fail, c.hold, p1(pct(c.pass, c.total))];

  // Key processes
  const procs = processSummary(d);
  const keyProcs = procs.filter((p) => p.isKey);
  if (keyProcs.length) {
    tokens.push(...section("Key Process Results"));
    tokens.push(...tableLines(countCols([{ title: "Code", width: 8 }, { title: "Process", width: 40 }]), keyProcs.map((p) => [p.code, p.process, ...countCells(p)])));
  }

  tokens.push(...section("Process-wise Inspection Results"));
  tokens.push(
    ...tableLines(
      countCols([{ title: "Seq", width: 5, align: "right" }, { title: "Code", width: 8 }, { title: "Process", width: 40 }, { title: "Key", width: 5 }]),
      procs.map((p) => [p.seq, p.code, p.process, p.isKey ? "Yes" : "", ...countCells(p)]),
      ["", "", "TOTAL", "", ...countCells(t)]
    )
  );

  tokens.push(...section("Grade-wise Inspection Results"));
  tokens.push(...tableLines(countCols([{ title: "Grade", width: 30 }]), gradeSummary(d).map((g) => [g.grade, ...countCells(g)]), ["TOTAL", ...countCells(t)]));

  tokens.push(...section("Grade-wise Results by Process"));
  tokens.push(...tableLines(countCols([{ title: "Grade", width: 26 }, { title: "Process", width: 40 }]), gradeProcessSummary(d).map((g) => [g.grade, g.process, ...countCells(g)])));

  tokens.push(...section("Daily Trend"));
  tokens.push(
    ...tableLines(
      countCols([{ title: "Date", width: 13 }, { title: "Day", width: 5 }]),
      dailyTrend(d).map((r) => [format(parseISO(r.date), "dd MMM yyyy"), format(parseISO(r.date), "EEE"), ...countCells(r)]),
      ["TOTAL", "", ...countCells(t)]
    )
  );

  tokens.push(...section("Inspections by Person"));
  tokens.push(
    ...tableLines(
      countCols([{ title: "Name", width: 26 }, { title: "Role", width: 18 }, { title: "Days", width: 6, align: "right" }]),
      personSummary(d).map((p) => [p.name, p.role, p.days, ...countCells(p)])
    )
  );

  tokens.push(...section("Operator / QA Officer Process-wise Inspections"));
  tokens.push(
    ...tableLines(
      countCols([{ title: "Name", width: 26 }, { title: "Role", width: 18 }, { title: "Process", width: 40 }]),
      personProcessSummary(d).map((p) => [p.name, p.role, p.process, ...countCells(p)])
    )
  );

  // Time vs Inspections: people as rows, hours as columns (fits landscape).
  (["QA Officer", "Machine Operator"] as const).forEach((role) => {
    const m = hourlyMatrix(d, role);
    tokens.push(...section(`${role === "QA Officer" ? "QA Officers" : "Machine Operators"} - Time vs Inspections`));
    const cols: Col[] = [
      { title: "Name", width: 22 },
      ...m.hours.map((h) => ({ title: String(h).padStart(2, "0"), width: 5, align: "right" as const })),
      { title: "Total", width: 7, align: "right" },
    ];
    tokens.push(
      ...tableLines(
        cols,
        m.rows.map((r) => [r.name, ...r.perHour.map((n) => (n ? n : "")), r.total]),
        m.rows.length ? ["TOTAL", ...m.hourTotals, m.rows.reduce((s, r) => s + r.total, 0)] : undefined
      )
    );
    if (m.hours.length) tokens.push(L("Columns are hour of day (24h) when the inspection was entered.", false, 6.5));
  });

  tokens.push(...section("NCR Severity Distribution"));
  tokens.push(
    ...tableLines(
      [{ title: "Severity", width: 12 }, { title: "Total", width: 8, align: "right" }, { title: "Open", width: 8, align: "right" }, { title: "Closed", width: 8, align: "right" }],
      ncrSeverity(d).map((s) => [s.severity, s.total, s.open, s.closed])
    )
  );

  tokens.push(...section("NCRs Raised in Period"));
  tokens.push(
    ...tableLines(
      [
        { title: "NCR #", width: 14 }, { title: "Date", width: 12 }, { title: "Severity", width: 10 }, { title: "Status", width: 11 },
        { title: "Department", width: 18 }, { title: "Grade", width: 16 }, { title: "Inspection #", width: 16 }, { title: "Description", width: 77 },
      ],
      d.ncrs.map((n) => [n.ncrNumber, format(parseISO(n.date), "dd MMM yyyy"), n.severity, n.status, n.department, n.grade, n.inspectionNumber, n.description.replace(/\s+/g, " ")])
    )
  );

  const pendingCapas = d.capas.filter((c) => c.isPending);
  tokens.push(...section("Pending CAPAs"));
  tokens.push(
    ...tableLines(
      [
        { title: "CAPA #", width: 14 }, { title: "Type", width: 12 }, { title: "Status", width: 11 }, { title: "NCR #", width: 14 },
        { title: "Responsible", width: 20 }, { title: "Target", width: 12 }, { title: "Overdue", width: 8 }, { title: "Description", width: 83 },
      ],
      pendingCapas.map((c) => [c.capaNumber, c.type, c.status, c.ncrNumber, c.responsible, c.targetDate ? format(parseISO(c.targetDate), "dd MMM yyyy") : "", c.overdue, c.description.replace(/\s+/g, " ")])
    )
  );

  if (d.input.todayPlanItems.length) {
    tokens.push(...section(`Today's Quality Plan (${format(parseISO(d.input.todayPlanDate), "dd MMM yyyy")})`));
    tokens.push(
      ...tableLines(
        [
          { title: "Department", width: 20 }, { title: "Process", width: 36 }, { title: "Grade", width: 20 }, { title: "Assigned To", width: 22 },
          { title: "Target", width: 8, align: "right" }, { title: "Done", width: 8, align: "right" }, { title: "Progress", width: 9, align: "right" },
        ],
        d.input.todayPlanItems.map((p) => [p.department, p.process, p.grade, p.assignedTo, p.target, p.completed, `${p.progress}%`])
      )
    );
  }

  tokens.push(...section("Inspection Details"));
  tokens.push(
    ...tableLines(
      [
        { title: "Inspection #", width: 16 }, { title: "Date", width: 12 }, { title: "Time", width: 6 }, { title: "Shift", width: 7 },
        { title: "Process", width: 32 }, { title: "Grade", width: 18 }, { title: "By", width: 20 }, { title: "Result", width: 7 },
        { title: "OOS", width: 5, align: "right" }, { title: "Remarks", width: 51 },
      ],
      d.inspections.map((r) => [
        r.inspectionNumber, format(parseISO(r.date), "dd MMM yyyy"), r.createdAt ? format(r.createdAt, "HH:mm") : "", r.shift,
        r.process, r.grade, r.createdBy, r.result, r.outOfSpecCount || "", r.remarks.replace(/\s+/g, " "),
      ])
    )
  );
  tokens.push(L("OOS = out-of-spec parameter readings. Full readings are in the Excel export (Readings sheet).", false, 6.5));

  // Paginate with a continuation header and page numbers.
  const pages: PdfToken[][] = [];
  let page: PdfToken[] = [];
  tokens.forEach((tk) => {
    // Section titles are size 10; don't leave one stranded without its table header and a few rows.
    const strandedTitle = tk.size === 10 && page.length >= MAX_LINES - 6;
    if (page.length >= MAX_LINES - 1 || strandedTitle) {
      pages.push(page);
      page = [L(`QA Dashboard Report - ${periodLabel(d)} (continued)`, true, 9), BLANK];
    }
    page.push(tk);
  });
  if (page.length) pages.push(page);
  pages.forEach((pg, i) => {
    while (pg.length < MAX_LINES - 1) pg.push(BLANK);
    pg.push(L(padLeft(`Page ${i + 1} of ${pages.length}`, MAX_CHARS), false, BODY));
  });

  return renderTextPdf(pages, PAGE_OPTS);
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
