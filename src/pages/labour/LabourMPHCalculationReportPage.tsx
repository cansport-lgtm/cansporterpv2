// MPH Calculation Report — department wise.
//
// Shows, for one production date, how each department's MPH was worked out:
//   A. Authorized MPH: every posted production item × its MPH number, with
//      sub-department subtotals, plus the department's fixed daily MPH.
//   B. Used MPH: every deployed worker (full day 12 / half day 6), grouped by
//      process.
//   C. Result: Authorized − Used = Net, efficiency, used MPH per unit against
//      the standard, and whether the loss has been explained in MPH Loss Reasons.
// The Range tab shows the same calculation over a period: a department × day
// matrix of net MPH and a day-by-day drill into one department.
//
// Figures come from the shared helpers in src/lib/mphLoss.ts, so they agree
// with MPH Analysis and MPH Loss Reasons. Read-only; nothing is saved here.
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { addDays, endOfMonth, format, isValid, parseISO, startOfMonth, subDays, subMonths } from "date-fns";
import {
  Activity, CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Factory, FileSpreadsheet,
  Gauge, Printer, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  MPH_NUMBER_COLUMNS, editedEntryStubs, escapeHtml, fetchMphDay, fixedDailyMph, fmtMph, fmtQty, mphRateLookup, round1,
  type DepartmentMph, type DepartmentMphDetail, type MphNumberRow, type MphWorkerRow,
} from "@/lib/mphLoss";
import { useProductionEntriesLive } from "@/lib/productionEntryEdits";
import { EditedBadge } from "@/components/production/EditedBadge";
import { EditedEntriesNote } from "@/components/production/EditedEntriesNote";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Reasons must add up to the loss within this many MPH (same as the database check).
const EXPLAIN_TOLERANCE = 0.05;

const isoDate = (d: Date) => format(d, "yyyy-MM-dd");
const fmtDate = (iso: string) => format(parseISO(iso), "EEE dd MMM yyyy");
const signed = (n: number) => `${n > 0 ? "+" : ""}${fmtMph(n)}`;
const netClass = (n: number) => (n < 0 ? "text-red-600" : n > 0 ? "text-green-600" : "text-muted-foreground");
const pct = (authorized: number, used: number) => (used > 0 ? `${fmtMph((authorized / used) * 100)}%` : "—");

type SortMode = "loss" | "name" | "authorized";

// Loss-reason state of one department on one date.
interface ReasonState {
  status: "draft" | "submitted";
  explained: number;
}

// One worker-process group: the rows plus full / half counts.
interface ProcessGroup {
  process: string;
  workers: MphWorkerRow[];
  full: number;
  half: number;
  hours: number;
  mph: number;
}

const groupByProcess = (workers: MphWorkerRow[]): ProcessGroup[] => {
  const groups: ProcessGroup[] = [];
  workers.forEach((w) => {
    let g = groups.find((x) => x.process === w.process);
    if (!g) {
      g = { process: w.process, workers: [], full: 0, half: 0, hours: 0, mph: 0 };
      groups.push(g);
    }
    g.workers.push(w);
    if (w.mph >= 12) g.full += 1;
    else g.half += 1;
    g.hours += w.hours ?? 0;
    g.mph += w.mph;
  });
  return groups;
};

const workTypeLabel = (mph: number) => (mph >= 12 ? "Full day" : mph > 0 ? "Half day" : "—");

// Reason status badge text for a department in loss.
const reasonText = (loss: number, state: ReasonState | undefined) => {
  if (!state || state.explained <= 0) return { text: "Loss reasons not started", tone: "warn" as const };
  if (state.explained < loss - EXPLAIN_TOLERANCE)
    return { text: `Partly explained · ${fmtMph(state.explained)} of ${fmtMph(loss)}`, tone: "warn" as const };
  return { text: `Reasons ${state.status} · ${fmtMph(state.explained)} MPH explained`, tone: "info" as const };
};

const toneClass = { warn: "bg-amber-100 text-amber-800", info: "bg-blue-100 text-blue-700" };

export default function LabourMPHCalculationReportPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<"day" | "range">("day");

  // ---- Day report ---------------------------------------------------------
  // Default: yesterday, the last day whose production is fully posted.
  const paramDate = params.get("date");
  const date = paramDate && isValid(parseISO(paramDate)) ? paramDate : isoDate(subDays(new Date(), 1));
  const setDate = (next: string) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set("date", next);
      return n;
    });
    setTab("day");
  };

  const [dayDept, setDayDept] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("loss");
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [openInit, setOpenInit] = useState<string | null>(null);

  // Re-fetch when any production entry is edited, so edit marks stay current.
  useProductionEntriesLive(["mph-loss-live", "mph-calc-range"]);

  const { data: day, isLoading: loadingDay, error: dayError } = useQuery({
    queryKey: ["mph-loss-live", date],
    queryFn: () => fetchMphDay(date),
  });

  const { data: dayReasons } = useQuery({
    queryKey: ["mph-calc-reasons", date],
    queryFn: () => fetchReasonStates(date, date),
  });

  const { data: departmentList = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: mphNumbers = [] } = useQuery({
    queryKey: ["mph-calculating-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("mph_calculating_numbers").select(MPH_NUMBER_COLUMNS).eq("is_active", true);
      if (error) throw error;
      return data as MphNumberRow[];
    },
  });

  const dayRows = useMemo(() => {
    const rows = (day?.departments ?? []).filter((d) => dayDept === "all" || d.department_id === dayDept);
    const sorted = [...rows];
    if (sortMode === "loss") sorted.sort((a, b) => (a.net_mph < 0 ? 0 : 1) - (b.net_mph < 0 ? 0 : 1) || a.net_mph - b.net_mph);
    else if (sortMode === "authorized") sorted.sort((a, b) => b.authorized_mph - a.authorized_mph);
    else sorted.sort((a, b) => a.department_name.localeCompare(b.department_name));
    return sorted;
  }, [day, dayDept, sortMode]);

  // Open the loss departments (or the first two) when a date first loads.
  useEffect(() => {
    if (!day || openInit === date) return;
    const loss = day.departments.filter((d) => d.net_mph < 0).map((d) => d.department_id);
    const first = day.departments.slice(0, 2).map((d) => d.department_id);
    setOpenIds(new Set(loss.length ? loss : first));
    setOpenInit(date);
  }, [day, date, openInit]);

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const setAll = (open: boolean) => setOpenIds(new Set(open ? dayRows.map((d) => d.department_id) : []));

  const dayTotals = useMemo(() => {
    const all = day?.departments ?? [];
    const output = all.reduce((s, d) => s + d.output, 0);
    const authorized = round1(all.reduce((s, d) => s + d.authorized_mph, 0));
    const used = round1(all.reduce((s, d) => s + d.used_mph, 0));
    const workers = all.reduce((s, d) => s + (day?.detail[d.department_id]?.workers.length ?? 0), 0);
    const lossDepts = all.filter((d) => d.net_mph < 0);
    return {
      output,
      authorized,
      used,
      net: round1(authorized - used),
      workers,
      lossCount: lossDepts.length,
      lossMph: round1(lossDepts.reduce((s, d) => s + d.net_mph, 0)),
      efficiency: used > 0 ? (authorized / used) * 100 : 0,
    };
  }, [day]);

  const reasonFor = (deptId: string): ReasonState | undefined => dayReasons?.get(`${deptId}|${date}`);

  // ---- Range report -------------------------------------------------------
  const [rangeMode, setRangeMode] = useState("month");
  const [customStart, setCustomStart] = useState<Date | undefined>(subDays(new Date(), 7));
  const [customEnd, setCustomEnd] = useState<Date | undefined>(new Date());
  const [drillDept, setDrillDept] = useState<string>("");

  const range = useMemo(() => {
    const today = new Date();
    switch (rangeMode) {
      case "week":
        return { start: isoDate(subDays(today, 7)), end: isoDate(today) };
      case "lastMonth": {
        const m = subMonths(today, 1);
        return { start: isoDate(startOfMonth(m)), end: isoDate(endOfMonth(m)) };
      }
      case "custom":
        if (customStart && customEnd) return { start: isoDate(customStart), end: isoDate(customEnd) };
        return { start: isoDate(today), end: isoDate(today) };
      default:
        return { start: isoDate(startOfMonth(today)), end: isoDate(today) };
    }
  }, [rangeMode, customStart, customEnd]);

  const { data: rangeData, isLoading: loadingRange } = useQuery({
    queryKey: ["mph-calc-range", range.start, range.end],
    enabled: tab === "range",
    queryFn: async () => {
      const [prodRes, usedRes, reasons] = await Promise.all([
        supabase
          .from("production_entries")
          .select("department_id, sub_department_id, quantity_produced, entry_date, edit_count")
          .gte("entry_date", range.start)
          .lte("entry_date", range.end)
          .limit(10000),
        supabase
          .from("labour_productivity_targets")
          .select("department_id, mph, target_date, employee_id")
          .gte("target_date", range.start)
          .lte("target_date", range.end)
          .limit(10000),
        fetchReasonStates(range.start, range.end),
      ]);
      if (prodRes.error) throw prodRes.error;
      if (usedRes.error) throw usedRes.error;
      return { production: prodRes.data ?? [], used: usedRes.data ?? [], reasons };
    },
  });

  interface RangeCell { output: number; itemsAuth: number; fixed: number; authorized: number; used: number; full: number; half: number; workers: number }
  const rangeCalc = useMemo(() => {
    const cells = new Map<string, RangeCell>(); // `${dept}|${date}`
    const dates = new Set<string>();
    const cell = (deptId: string, d: string) => {
      const key = `${deptId}|${d}`;
      let c = cells.get(key);
      if (!c) {
        c = { output: 0, itemsAuth: 0, fixed: 0, authorized: 0, used: 0, full: 0, half: 0, workers: 0 };
        cells.set(key, c);
      }
      dates.add(d);
      return c;
    };
    if (!rangeData) return { cells, dates: [] as string[] };
    const rate = mphRateLookup(mphNumbers);
    rangeData.production.forEach((e) => {
      if (!e.department_id) return;
      const qty = Number(e.quantity_produced || 0);
      const c = cell(e.department_id, e.entry_date);
      c.output += qty;
      c.itemsAuth += qty * rate(e.department_id, e.sub_department_id);
    });
    rangeData.used.forEach((e) => {
      if (!e.department_id) return;
      const mph = Number(e.mph || 0);
      const c = cell(e.department_id, e.target_date);
      c.used += mph;
      c.workers += 1;
      if (mph >= 12) c.full += 1;
      else if (mph > 0) c.half += 1;
    });
    cells.forEach((c, key) => {
      const [deptId, d] = key.split("|");
      if (c.workers > 0) c.fixed = fixedDailyMph(mphNumbers, deptId, d);
      c.authorized = round1(c.itemsAuth + c.fixed);
      c.used = round1(c.used);
    });
    return { cells, dates: [...dates].sort() };
  }, [rangeData, mphNumbers]);

  const rangeRows = useMemo(() => {
    return departmentList
      .map((dept) => {
        let authorized = 0, used = 0, output = 0, days = 0;
        const byDate = rangeCalc.dates.map((d) => {
          const c = rangeCalc.cells.get(`${dept.id}|${d}`);
          if (!c) return null;
          authorized += c.authorized;
          used += c.used;
          output += c.output;
          days += 1;
          return c;
        });
        if (days === 0) return null;
        return { id: dept.id, name: dept.name, byDate, authorized: round1(authorized), used: round1(used), net: round1(authorized - used), output, days };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [departmentList, rangeCalc]);

  const rangeTotals = useMemo(() => {
    const authorized = round1(rangeRows.reduce((s, r) => s + r.authorized, 0));
    const used = round1(rangeRows.reduce((s, r) => s + r.used, 0));
    const output = rangeRows.reduce((s, r) => s + r.output, 0);
    const worst = [...rangeRows].sort((a, b) => a.net - b.net)[0];
    const byDate = rangeCalc.dates.map((_, i) => round1(rangeRows.reduce((s, r) => s + (r.byDate[i] ? r.byDate[i]!.authorized - r.byDate[i]!.used : 0), 0)));
    return { authorized, used, output, net: round1(authorized - used), worst, byDate, efficiency: used > 0 ? (authorized / used) * 100 : 0 };
  }, [rangeRows, rangeCalc]);

  useEffect(() => {
    if (!drillDept && rangeRows.length) setDrillDept(rangeTotals.worst?.id ?? rangeRows[0].id);
  }, [rangeRows, rangeTotals.worst, drillDept]);

  const drillRow = rangeRows.find((r) => r.id === drillDept);

  // ---- Print / Excel ------------------------------------------------------
  const handlePrint = () => {
    if (!day) return;
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("Allow pop-ups to print");
      return;
    }
    const summary = dayRows
      .map((d) => {
        const det = day.detail[d.department_id];
        const reason = d.net_mph < 0 ? reasonText(-d.net_mph, reasonFor(d.department_id)).text : "—";
        return `<tr><td class="b">${escapeHtml(d.department_name)}</td><td class="n">${d.output ? fmtQty(d.output) : "—"}</td>
          <td class="n">${fmtMph(d.authorized_mph - (det?.fixed_daily_mph ?? 0))}</td><td class="n">${det?.fixed_daily_mph ? fmtMph(det.fixed_daily_mph) : "—"}</td>
          <td class="n">${fmtMph(d.authorized_mph)}</td><td class="n">${det?.workers.length ?? 0}</td><td class="n">${fmtMph(d.used_mph)}</td>
          <td class="n b">${signed(d.net_mph)}</td><td class="n">${pct(d.authorized_mph, d.used_mph)}</td><td class="muted">${escapeHtml(reason)}</td></tr>`;
      })
      .join("");
    const blocks = dayRows
      .map((d, i) => {
        const det = day.detail[d.department_id];
        const items = (det?.items ?? [])
          .map(
            (it) => `<tr><td>${escapeHtml(it.item_name)}</td><td>${escapeHtml(it.sub_department)}</td><td>${escapeHtml(it.shift)}</td>
              <td class="n">${fmtQty(it.output)}</td><td class="n">${it.mph_number.toFixed(3)}</td><td class="n">${fmtMph(it.authorized)}</td></tr>`
          )
          .join("");
        const groups = groupByProcess(det?.workers ?? [])
          .map(
            (g) => `<tr><td>${escapeHtml(g.process)}</td><td class="n">${g.workers.length}</td><td class="n">${g.full}</td><td class="n">${g.half}</td>
              <td class="n">${g.hours.toFixed(1)}</td><td class="n">${fmtMph(g.mph)}</td></tr>`
          )
          .join("");
        const nFull = (det?.workers ?? []).filter((x) => x.mph >= 12).length;
        const nWorkers = det?.workers.length ?? 0;
        const reason = d.net_mph < 0 ? reasonText(-d.net_mph, reasonFor(d.department_id)).text : "";
        return `<h2>${i + 1}. ${escapeHtml(d.department_name)}<span>Authorized ${fmtMph(d.authorized_mph)} − Used ${fmtMph(d.used_mph)} = ${signed(d.net_mph)} MPH · ${pct(d.authorized_mph, d.used_mph)}</span></h2>
          <div class="two"><div>
            <table><thead><tr><th>Item</th><th>Sub-dept</th><th>Shift</th><th class="n">Output</th><th class="n">MPH no.</th><th class="n">Authorized</th></tr></thead><tbody>
            ${items || '<tr><td colspan="6" class="muted">No countable output</td></tr>'}
            ${det?.fixed_daily_mph ? `<tr><td colspan="5">Fixed daily MPH</td><td class="n">${fmtMph(det.fixed_daily_mph)}</td></tr>` : ""}
            <tr class="t"><td colspan="3">Authorized</td><td class="n">${d.output ? fmtQty(d.output) : "—"}</td><td></td><td class="n">${fmtMph(d.authorized_mph)}</td></tr></tbody></table>
          </div><div>
            <table><thead><tr><th>Process</th><th class="n">Workers</th><th class="n">Full</th><th class="n">Half</th><th class="n">Hours</th><th class="n">Used MPH</th></tr></thead><tbody>
            ${groups || '<tr><td colspan="6" class="muted">Nobody deployed</td></tr>'}
            <tr class="t"><td>Used</td><td class="n">${nWorkers}</td><td class="n">${nFull}</td><td class="n">${nWorkers - nFull}</td><td></td><td class="n">${fmtMph(d.used_mph)}</td></tr></tbody></table>
          </div></div>
          ${d.net_mph < 0 ? `<div class="res">Loss ${fmtMph(-d.net_mph)} MPH · ${escapeHtml(reason)}</div>` : ""}`;
      })
      .join("");
    const fixedTotal = dayRows.reduce((s, d) => s + (day.detail[d.department_id]?.fixed_daily_mph ?? 0), 0);
    const tot = {
      output: dayRows.reduce((s, d) => s + d.output, 0),
      authorized: round1(dayRows.reduce((s, d) => s + d.authorized_mph, 0)),
      used: round1(dayRows.reduce((s, d) => s + d.used_mph, 0)),
      workers: dayRows.reduce((s, d) => s + (day.detail[d.department_id]?.workers.length ?? 0), 0),
    };
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
      <title>MPH Calculation Report ${escapeHtml(date)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; font-size: 11px; }
        .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
        h1 { font-size: 18px; margin: 2px 0 4px; }
        h2 { font-size: 13px; margin: 14px 0 6px; display: flex; justify-content: space-between; gap: 10px; border-left: 4px solid #111; padding-left: 8px; page-break-after: avoid; }
        h2 span { font-weight: normal; font-family: Menlo, Consolas, monospace; font-size: 11px; }
        table { width: 100%; border-collapse: collapse; }
        th { font-size: 10px; text-transform: uppercase; text-align: left; padding: 4px 6px; border-bottom: 1.5px solid #111; }
        td { padding: 3px 6px; border-bottom: 1px solid #ccc; vertical-align: top; }
        tr.t td { font-weight: bold; border-top: 1.5px solid #111; border-bottom: 0; }
        .n { text-align: right; white-space: nowrap; } .b { font-weight: bold; } .muted { color: #555; }
        .two { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; page-break-inside: avoid; }
        .res { font-family: Menlo, Consolas, monospace; font-size: 10.5px; margin-top: 6px; background: #f3f3f3; padding: 5px 8px; }
        .sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; margin-top: 40px; }
        .sign div { border-top: 1px solid #111; padding-top: 6px; text-align: center; }
        .foot { margin-top: 14px; font-size: 9.5px; color: #555; }
      </style></head><body>
      <div class="head">
        <div><div class="muted">Labour Productivity</div><h1>MPH Calculation Report — Department wise</h1>
          <div>Production date: <b>${fmtDate(date)}</b>${dayDept !== "all" ? ` · ${escapeHtml(dayRows[0]?.department_name ?? "")}` : ""}</div></div>
        <div style="text-align:right"><div>Printed ${format(new Date(), "dd MMM yyyy, HH:mm")}</div><div>Full day = 12 MPH · Half day = 6 MPH</div></div>
      </div>
      <table><thead><tr><th>Department</th><th class="n">Output</th><th class="n">Σ output × MPH no.</th><th class="n">Fixed MPH</th><th class="n">Authorized</th>
        <th class="n">Workers</th><th class="n">Used</th><th class="n">Net</th><th class="n">Eff.</th><th>Loss reasons</th></tr></thead>
        <tbody>${summary || '<tr><td colspan="10" class="muted">No production or deployment on this date</td></tr>'}
        <tr class="t"><td>Total</td><td class="n">${fmtQty(tot.output)}</td><td class="n">${fmtMph(tot.authorized - fixedTotal)}</td><td class="n">${fixedTotal ? fmtMph(fixedTotal) : "—"}</td>
          <td class="n">${fmtMph(tot.authorized)}</td><td class="n">${tot.workers}</td><td class="n">${fmtMph(tot.used)}</td><td class="n">${signed(round1(tot.authorized - tot.used))}</td>
          <td class="n">${pct(tot.authorized, tot.used)}</td><td></td></tr></tbody></table>
      ${blocks}
      <div class="sign"><div>Production Coordinator</div><div>Labour In-charge</div><div>Operations Manager</div></div>
      <div class="foot">MPH number = MPH Master (department + sub-department). Fixed daily MPH is counted once per day when anyone is deployed. Figures rounded to 0.1 MPH.${day.editedEntryCount > 0 ? ` Output figures include ${day.editedEntryCount} production ${day.editedEntryCount === 1 ? "entry" : "entries"} edited after first save.` : ""}</div>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const handleExcel = async () => {
    if (!day) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();
      const summary = XLSX.utils.aoa_to_sheet([
        ["MPH Calculation Report", fmtDate(date)],
        day.editedEntryCount > 0 ? [`Edited production entries included: ${day.editedEntryCount}`] : [],
        ["Department", "Output", "Σ output × MPH no.", "Fixed MPH", "Authorized MPH", "Workers", "Used MPH", "Net MPH", "Efficiency %", "Loss reasons"],
        ...dayRows.map((d) => {
          const det = day.detail[d.department_id];
          return [
            d.department_name,
            d.output,
            round1(d.authorized_mph - (det?.fixed_daily_mph ?? 0)),
            det?.fixed_daily_mph ?? 0,
            d.authorized_mph,
            det?.workers.length ?? 0,
            d.used_mph,
            d.net_mph,
            d.used_mph > 0 ? round1((d.authorized_mph / d.used_mph) * 100) : null,
            d.net_mph < 0 ? reasonText(-d.net_mph, reasonFor(d.department_id)).text : "",
          ];
        }),
      ]);
      XLSX.utils.book_append_sheet(wb, summary, "Summary");
      const items = XLSX.utils.aoa_to_sheet([
        ["Date", "Department", "Item", "Code", "Sub-department", "Shift", "Output", "MPH number", "Authorized MPH"],
        ...dayRows.flatMap((d) =>
          (day.detail[d.department_id]?.items ?? []).map((it) => [date, d.department_name, it.item_name, it.item_code, it.sub_department, it.shift, it.output, it.mph_number, it.authorized])
        ),
        ...dayRows
          .filter((d) => (day.detail[d.department_id]?.fixed_daily_mph ?? 0) > 0)
          .map((d) => [date, d.department_name, "Fixed daily MPH", "", "", "", "", "", day.detail[d.department_id].fixed_daily_mph]),
      ]);
      XLSX.utils.book_append_sheet(wb, items, "Authorized (items)");
      const workers = XLSX.utils.aoa_to_sheet([
        ["Date", "Department", "Code", "Worker", "Process", "Shift", "Hours", "Work type", "MPH"],
        ...dayRows.flatMap((d) =>
          (day.detail[d.department_id]?.workers ?? []).map((wk) => [date, d.department_name, wk.employee_code, wk.employee_name, wk.process, wk.shift, wk.hours ?? "", workTypeLabel(wk.mph), wk.mph])
        ),
      ]);
      XLSX.utils.book_append_sheet(wb, workers, "Used (workers)");
      XLSX.writeFile(wb, `MPH-Calculation-${date}.xlsx`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not export");
    }
  };

  // ---- Render -------------------------------------------------------------
  return (
    <ERPLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader
          title="MPH Calculation Report"
          description="Department wise: every production item × MPH number against every deployed worker at 12 / 6 MPH"
        >
          <Button variant="outline" onClick={handleExcel} disabled={!day || dayRows.length === 0}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />Export Excel
          </Button>
          <Button onClick={handlePrint} disabled={!day || dayRows.length === 0}>
            <Printer className="h-4 w-4 mr-2" />Print A4
          </Button>
        </PageHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "day" | "range")}>
          <TabsList>
            <TabsTrigger value="day">Day report</TabsTrigger>
            <TabsTrigger value="range">Range report</TabsTrigger>
          </TabsList>

          {/* ---------------- DAY ---------------- */}
          <TabsContent value="day" className="space-y-6 mt-4">
            <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4 md:items-end">
              <div className="col-span-2 md:col-auto">
                <label className="text-xs text-muted-foreground mb-1 block">Production date</label>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" aria-label="Previous day" onClick={() => setDate(isoDate(subDays(parseISO(date), 1)))}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className="flex-1 md:flex-none md:w-[190px] justify-start">
                        <CalendarIcon className="h-4 w-4 mr-2" />
                        {fmtDate(date)}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={parseISO(date)} onSelect={(d) => d && setDate(isoDate(d))} />
                    </PopoverContent>
                  </Popover>
                  <Button variant="outline" size="icon" aria-label="Next day" onClick={() => setDate(isoDate(addDays(parseISO(date), 1)))}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground mb-1 block">Department</label>
                <Select value={dayDept} onValueChange={setDayDept}>
                  <SelectTrigger className="w-full md:w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All departments</SelectItem>
                    {departmentList.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground mb-1 block">Order</label>
                <Select value={sortMode} onValueChange={(v) => setSortMode(v as SortMode)}>
                  <SelectTrigger className="w-full md:w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="loss">Loss departments first</SelectItem>
                    <SelectItem value="name">Department name</SelectItem>
                    <SelectItem value="authorized">Largest authorized first</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2 flex gap-2 md:col-auto">
                <Button variant="outline" size="sm" className="flex-1 md:flex-none" onClick={() => setAll(true)}>Expand all</Button>
                <Button variant="outline" size="sm" className="flex-1 md:flex-none" onClick={() => setAll(false)}>Collapse all</Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
              <MetricCard title="Production Output" value={fmtQty(dayTotals.output)} icon={Factory} description={`${day?.departments.length ?? 0} departments`} />
              <MetricCard title="Authorized MPH" value={fmtMph(dayTotals.authorized)} icon={Gauge} description="Σ output × MPH number + fixed daily MPH" />
              <MetricCard title="Used MPH" value={fmtMph(dayTotals.used)} icon={Users} description={`${dayTotals.workers} workers deployed`} />
              <MetricCard
                title="Net MPH"
                value={signed(dayTotals.net)}
                icon={dayTotals.net >= 0 ? TrendingUp : TrendingDown}
                iconColor={dayTotals.net >= 0 ? "text-green-600" : "text-red-600"}
                description={dayTotals.lossCount ? `${dayTotals.lossCount} departments in loss (${fmtMph(dayTotals.lossMph)})` : "No department in loss"}
              />
              <MetricCard
                className="col-span-2 lg:col-span-1"
                title="MPH Efficiency"
                value={dayTotals.used > 0 ? `${fmtMph(dayTotals.efficiency)}%` : "—"}
                icon={Activity}
                iconColor={dayTotals.efficiency >= 100 ? "text-green-600" : "text-red-600"}
                description="Authorized ÷ Used"
              />
            </div>

            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Full day = 12 MPH · Half day = 6 MPH · figures rounded to 0.1 MPH · same calculation as MPH Analysis</span>
              <EditedEntriesNote entries={editedEntryStubs(day?.editedEntryCount)} prefix="Output figures include" />
            </p>

            {dayError ? (
              <Card><CardContent className="py-8 text-center text-sm text-red-600">{(dayError as Error).message}</CardContent></Card>
            ) : loadingDay ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Loading...</CardContent></Card>
            ) : dayRows.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No production entries or deployment posted for {fmtDate(date)}</CardContent></Card>
            ) : (
              <div className="space-y-3">
                {dayRows.map((d) => (
                  <DepartmentCard
                    key={d.department_id}
                    dept={d}
                    detail={day!.detail[d.department_id]}
                    open={openIds.has(d.department_id)}
                    onToggle={() => toggle(d.department_id)}
                    reason={reasonFor(d.department_id)}
                    date={date}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* ---------------- RANGE ---------------- */}
          <TabsContent value="range" className="space-y-6 mt-4">
            <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:gap-4 md:items-end">
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground mb-1 block">Date range</label>
                <Select value={rangeMode} onValueChange={setRangeMode}>
                  <SelectTrigger className="w-full md:w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">This month (to date)</SelectItem>
                    <SelectItem value="week">Last 7 days</SelectItem>
                    <SelectItem value="lastMonth">Last month</SelectItem>
                    <SelectItem value="custom">Custom range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {rangeMode === "custom" && (
                <>
                  <div className="min-w-0">
                    <label className="text-xs text-muted-foreground mb-1 block">From</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full md:w-[150px] justify-start">
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {customStart ? format(customStart, "dd MMM yyyy") : "Pick date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={customStart} onSelect={setCustomStart} />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="min-w-0">
                    <label className="text-xs text-muted-foreground mb-1 block">To</label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full md:w-[150px] justify-start">
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {customEnd ? format(customEnd, "dd MMM yyyy") : "Pick date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={customEnd} onSelect={setCustomEnd} />
                      </PopoverContent>
                    </Popover>
                  </div>
                </>
              )}
              <div className="min-w-0">
                <label className="text-xs text-muted-foreground mb-1 block">Drill into department</label>
                <Select value={drillDept} onValueChange={setDrillDept}>
                  <SelectTrigger className="w-full md:w-[200px]"><SelectValue placeholder="Department" /></SelectTrigger>
                  <SelectContent>
                    {rangeRows.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-5">
              <MetricCard title="Production Days" value={rangeCalc.dates.length} icon={CalendarIcon} description={`${format(parseISO(range.start), "dd MMM")} – ${format(parseISO(range.end), "dd MMM yyyy")}`} />
              <MetricCard title="Authorized MPH" value={fmtMph(rangeTotals.authorized)} icon={Gauge} description={`Output ${fmtQty(rangeTotals.output)}`} />
              <MetricCard title="Used MPH" value={fmtMph(rangeTotals.used)} icon={Users} description="All departments" />
              <MetricCard
                title="Net MPH"
                value={signed(rangeTotals.net)}
                icon={rangeTotals.net >= 0 ? TrendingUp : TrendingDown}
                iconColor={rangeTotals.net >= 0 ? "text-green-600" : "text-red-600"}
                description={rangeTotals.used > 0 ? `Efficiency ${fmtMph(rangeTotals.efficiency)}%` : "—"}
              />
              <MetricCard
                className="col-span-2 lg:col-span-1"
                title="Biggest Loss"
                value={rangeTotals.worst && rangeTotals.worst.net < 0 ? rangeTotals.worst.name : "None"}
                icon={TrendingDown}
                iconColor="text-red-600"
                description={rangeTotals.worst && rangeTotals.worst.net < 0 ? `${fmtMph(rangeTotals.worst.net)} MPH in the period` : "No department in loss"}
              />
            </div>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex flex-wrap items-center gap-2">
                  <span>Net MPH by department and day <span className="text-sm font-normal text-muted-foreground">· click a day to open that day's report</span></span>
                  <EditedEntriesNote entries={rangeData?.production} prefix="Output figures include" />
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs font-semibold sticky left-0 bg-muted">Department</TableHead>
                        {rangeCalc.dates.map((d) => (
                          <TableHead key={d} className="text-xs font-semibold text-right px-2">{format(parseISO(d), "dd")}</TableHead>
                        ))}
                        <TableHead className="text-xs font-semibold text-right">Authorized</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Used</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Net</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Eff.</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingRange ? (
                        <TableRow><TableCell colSpan={rangeCalc.dates.length + 5} className="text-center text-sm text-muted-foreground py-8">Loading...</TableCell></TableRow>
                      ) : rangeRows.length === 0 ? (
                        <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-8">No data for the selected period</TableCell></TableRow>
                      ) : (
                        <>
                          {rangeRows.map((r) => (
                            <TableRow key={r.id}>
                              <TableCell className="text-sm font-medium sticky left-0 bg-background whitespace-nowrap">{r.name}</TableCell>
                              {r.byDate.map((c, i) => {
                                const d = rangeCalc.dates[i];
                                if (!c) return <TableCell key={d} className="text-right text-xs text-muted-foreground px-2">—</TableCell>;
                                const n = round1(c.authorized - c.used);
                                return (
                                  <TableCell
                                    key={d}
                                    className={`text-right text-xs px-2 font-mono cursor-pointer ${n < 0 ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
                                    title={`${r.name} · ${format(parseISO(d), "dd MMM")}: ${fmtMph(c.authorized)} − ${fmtMph(c.used)}`}
                                    onClick={() => setDate(d)}
                                  >
                                    {signed(n)}
                                  </TableCell>
                                );
                              })}
                              <TableCell className="text-right text-sm">{fmtMph(r.authorized)}</TableCell>
                              <TableCell className="text-right text-sm">{fmtMph(r.used)}</TableCell>
                              <TableCell className={`text-right text-sm font-bold ${netClass(r.net)}`}>{signed(r.net)}</TableCell>
                              <TableCell className="text-right text-sm">{pct(r.authorized, r.used)}</TableCell>
                            </TableRow>
                          ))}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell className="sticky left-0 bg-muted">Total</TableCell>
                            {rangeTotals.byDate.map((n, i) => (
                              <TableCell key={rangeCalc.dates[i]} className={`text-right text-xs px-2 font-mono ${netClass(n)}`}>{signed(n)}</TableCell>
                            ))}
                            <TableCell className="text-right text-sm">{fmtMph(rangeTotals.authorized)}</TableCell>
                            <TableCell className="text-right text-sm">{fmtMph(rangeTotals.used)}</TableCell>
                            <TableCell className={`text-right text-sm ${netClass(rangeTotals.net)}`}>{signed(rangeTotals.net)}</TableCell>
                            <TableCell className="text-right text-sm">{pct(rangeTotals.authorized, rangeTotals.used)}</TableCell>
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {drillRow ? drillRow.name : "Department"} · day by day <span className="text-sm font-normal text-muted-foreground">· the same calculation, one row per production date</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs font-semibold">Date</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Output</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Σ output × MPH no.</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Fixed MPH</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Authorized</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Workers</TableHead>
                        <TableHead className="text-xs font-semibold">Full / half</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Used</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Net</TableHead>
                        <TableHead className="text-xs font-semibold text-right">Eff.</TableHead>
                        <TableHead className="text-xs font-semibold">Loss reasons</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {!drillRow ? (
                        <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-8">No data for the selected period</TableCell></TableRow>
                      ) : (
                        <>
                          {drillRow.byDate.map((c, i) => {
                            const d = rangeCalc.dates[i];
                            if (!c) return null;
                            const n = round1(c.authorized - c.used);
                            const state = rangeData?.reasons.get(`${drillRow.id}|${d}`);
                            const rt = n < 0 ? reasonText(-n, state) : null;
                            return (
                              <TableRow key={d}>
                                <TableCell className="text-sm font-medium whitespace-nowrap">
                                  <button type="button" className="hover:underline" onClick={() => setDate(d)}>{format(parseISO(d), "EEE dd MMM")}</button>
                                </TableCell>
                                <TableCell className="text-right text-sm">{c.output ? fmtQty(c.output) : "—"}</TableCell>
                                <TableCell className="text-right text-sm">{fmtMph(c.itemsAuth)}</TableCell>
                                <TableCell className="text-right text-sm text-muted-foreground">{c.fixed ? fmtMph(c.fixed) : "—"}</TableCell>
                                <TableCell className="text-right text-sm font-medium">{fmtMph(c.authorized)}</TableCell>
                                <TableCell className="text-right text-sm">{c.workers}</TableCell>
                                <TableCell className="text-sm font-mono whitespace-nowrap">{c.full} × 12 + {c.half} × 6</TableCell>
                                <TableCell className="text-right text-sm font-medium">{fmtMph(c.used)}</TableCell>
                                <TableCell className={`text-right text-sm font-bold ${netClass(n)}`}>{signed(n)}</TableCell>
                                <TableCell className="text-right text-sm">{pct(c.authorized, c.used)}</TableCell>
                                <TableCell>
                                  {rt ? <Badge className={`${toneClass[rt.tone]} text-[10px] px-1`}>{rt.text}</Badge> : <span className="text-muted-foreground">—</span>}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          <TableRow className="bg-muted/50 font-bold">
                            <TableCell className="whitespace-nowrap">{drillRow.days} days</TableCell>
                            <TableCell className="text-right text-sm">{fmtQty(drillRow.output)}</TableCell>
                            <TableCell className="text-right text-sm">{fmtMph(drillRow.byDate.reduce((s, c) => s + (c?.itemsAuth ?? 0), 0))}</TableCell>
                            <TableCell className="text-right text-sm">{fmtMph(drillRow.byDate.reduce((s, c) => s + (c?.fixed ?? 0), 0))}</TableCell>
                            <TableCell className="text-right text-sm">{fmtMph(drillRow.authorized)}</TableCell>
                            <TableCell />
                            <TableCell />
                            <TableCell className="text-right text-sm">{fmtMph(drillRow.used)}</TableCell>
                            <TableCell className={`text-right text-sm ${netClass(drillRow.net)}`}>{signed(drillRow.net)}</TableCell>
                            <TableCell className="text-right text-sm">{pct(drillRow.authorized, drillRow.used)}</TableCell>
                            <TableCell />
                          </TableRow>
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}

// Loss-reason state per (department, date) for every report in the range:
// status and the MPH explained by its lines.
async function fetchReasonStates(start: string, end: string): Promise<Map<string, ReasonState>> {
  const map = new Map<string, ReasonState>();
  const { data: reports, error } = await (supabase as any)
    .from("mph_loss_reports")
    .select("id, report_date, status")
    .gte("report_date", start)
    .lte("report_date", end);
  if (error) throw error;
  if (!reports?.length) return map;
  const { data: lines, error: lineError } = await (supabase as any)
    .from("mph_loss_report_lines")
    .select("report_id, department_id, mph_lost")
    .in("report_id", reports.map((r: any) => r.id))
    .is("superseded_at", null);
  if (lineError) throw lineError;
  const dateOf: Record<string, { date: string; status: "draft" | "submitted" }> = {};
  reports.forEach((r: any) => (dateOf[r.id] = { date: r.report_date, status: r.status }));
  (lines ?? []).forEach((l: any) => {
    const rep = dateOf[l.report_id];
    if (!rep) return;
    const key = `${l.department_id}|${rep.date}`;
    const cur = map.get(key) ?? { status: rep.status, explained: 0 };
    cur.explained = round1(cur.explained + Number(l.mph_lost || 0));
    map.set(key, cur);
  });
  return map;
}

// ---- Department card ------------------------------------------------------

function DepartmentCard({
  dept, detail, open, onToggle, reason, date,
}: {
  dept: DepartmentMph;
  detail: DepartmentMphDetail | undefined;
  open: boolean;
  onToggle: () => void;
  reason: ReasonState | undefined;
  date: string;
}) {
  const items = detail?.items ?? [];
  const workers = detail?.workers ?? [];
  const fixed = detail?.fixed_daily_mph ?? 0;
  const itemsAuth = round1(dept.authorized_mph - fixed);
  const loss = dept.net_mph < 0;
  const nFull = workers.filter((w) => w.mph >= 12).length;
  const groups = groupByProcess(workers);
  const rt = loss ? reasonText(-dept.net_mph, reason) : null;

  // Items grouped by sub-department, keeping the order fetchMphDay sorted them in.
  const subGroups: { sub: string; rows: typeof items }[] = [];
  items.forEach((it) => {
    const g = subGroups[subGroups.length - 1];
    if (g && g.sub === it.sub_department) g.rows.push(it);
    else subGroups.push({ sub: it.sub_department, rows: [it] });
  });

  return (
    <Card className={`border-l-4 ${loss ? "border-l-red-500" : "border-l-green-500"}`}>
      <button type="button" className="w-full text-left px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 md:gap-x-5 md:gap-y-1 hover:bg-muted/40" onClick={onToggle}>
        <span className="order-1 md:order-none flex-1 md:flex-none min-w-0 md:min-w-[140px] text-base font-semibold truncate">{dept.department_name}</span>
        <span className="order-3 md:order-none w-full md:w-auto md:flex-1 grid grid-cols-2 gap-x-4 gap-y-0.5 md:flex md:flex-wrap md:gap-y-1 text-sm text-muted-foreground">
          <span>Output <b className="text-foreground font-medium">{dept.output ? fmtQty(dept.output) : "—"}</b></span>
          <span>Authorized <b className="text-foreground font-medium">{fmtMph(dept.authorized_mph)}</b></span>
          <span>Used <b className="text-foreground font-medium">{fmtMph(dept.used_mph)}</b> · {workers.length} workers</span>
          <span>Eff. <b className="text-foreground font-medium">{pct(dept.authorized_mph, dept.used_mph)}</b></span>
        </span>
        {loss ? (
          <Badge className="order-4 md:order-none bg-red-100 text-red-700">Loss {fmtMph(dept.net_mph)}</Badge>
        ) : (
          <Badge className="order-4 md:order-none bg-green-100 text-green-700">Saved {signed(dept.net_mph)}</Badge>
        )}
        <span className={`order-2 md:order-none text-lg font-semibold tabular-nums ${netClass(dept.net_mph)}`}>{signed(dept.net_mph)}</span>
        <span className="order-5 md:order-none ml-auto md:ml-0 text-xs text-primary inline-flex items-center gap-1">
          {open ? <>Hide calculation <ChevronUp className="h-3 w-3" /></> : <>Show calculation <ChevronDown className="h-3 w-3" /></>}
        </span>
      </button>

      {open && (
        <CardContent className="border-t pt-4 space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {/* A · Authorized */}
            <div className="min-w-0">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">A · Authorized MPH — earned from production</h4>
              {items.length === 0 && !fixed ? (
                <p className="text-sm text-muted-foreground">No production entries posted for this department.</p>
              ) : (
                <>
                <div className="md:hidden rounded-md border divide-y text-sm">
                  {subGroups.map((g) => (
                    <Fragment key={g.sub}>
                      {g.rows.map((it, i) => (
                        <div key={i} className="px-3 py-2">
                          <div className="flex justify-between gap-2">
                            <span className="font-medium truncate">
                              {it.item_name}
                              {it.id && <EditedBadge entry={it as { id: string; edit_count?: number | null }} compact className="ml-1.5 align-middle" />}
                            </span>
                            <span className="font-medium tabular-nums">{fmtMph(it.authorized)}</span>
                          </div>
                          <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                            <span className="truncate">{it.sub_department !== "—" ? `${it.sub_department} · ` : ""}{it.shift || "—"}</span>
                            <span className="font-mono whitespace-nowrap">{fmtQty(it.output)} × {it.mph_number.toFixed(3)}</span>
                          </div>
                        </div>
                      ))}
                      {g.rows.length > 1 && g.sub !== "—" && (
                        <div className="flex justify-between gap-2 px-3 py-1.5 bg-muted/30 text-xs font-medium">
                          <span className="truncate">{g.sub} subtotal · {fmtQty(g.rows.reduce((s, it) => s + it.output, 0))}</span>
                          <span className="tabular-nums">{fmtMph(g.rows.reduce((s, it) => s + it.output * it.mph_number, 0))}</span>
                        </div>
                      )}
                    </Fragment>
                  ))}
                  {fixed > 0 && (
                    <div className="flex justify-between gap-2 px-3 py-2">
                      <span className="text-xs">Fixed daily MPH ({workers.length} deployed)</span>
                      <span className="tabular-nums">{fmtMph(fixed)}</span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2 px-3 py-2 bg-muted/30 font-semibold">
                    <span>Authorized MPH{dept.output ? ` · ${fmtQty(dept.output)} pcs` : ""}</span>
                    <span className="tabular-nums">{fmtMph(dept.authorized_mph)}</span>
                  </div>
                </div>
                <div className="hidden md:block overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">Item</TableHead>
                        <TableHead className="text-xs">Sub-department</TableHead>
                        <TableHead className="text-xs">Shift</TableHead>
                        <TableHead className="text-xs text-right">Output</TableHead>
                        <TableHead className="text-xs text-right">MPH no.</TableHead>
                        <TableHead className="text-xs text-right">Authorized</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subGroups.map((g) => (
                        <SubGroupRows key={g.sub} sub={g.sub} rows={g.rows} />
                      ))}
                      {fixed > 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="text-sm">Fixed daily MPH (MPH Master · department row · counted because {workers.length} deployed)</TableCell>
                          <TableCell className="text-right text-sm">{fmtMph(fixed)}</TableCell>
                        </TableRow>
                      )}
                      <TableRow className="font-semibold bg-muted/30">
                        <TableCell colSpan={3} className="text-sm">Authorized MPH</TableCell>
                        <TableCell className="text-right text-sm">{dept.output ? fmtQty(dept.output) : "—"}</TableCell>
                        <TableCell />
                        <TableCell className="text-right text-sm">{fmtMph(dept.authorized_mph)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                </>
              )}
            </div>

            {/* B · Used */}
            <div className="min-w-0">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">B · Used MPH — labour deployed</h4>
              {workers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nobody deployed in this department.</p>
              ) : (
                <>
                <div className="md:hidden rounded-md border text-sm max-h-[420px] overflow-auto">
                  {groups.map((g) => (
                    <Fragment key={g.process}>
                      <div className="flex justify-between gap-2 px-3 py-1 bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <span className="truncate">{g.process} · {g.workers.length} ({g.full} full, {g.half} half)</span>
                        <span className="tabular-nums">{fmtMph(g.mph)}</span>
                      </div>
                      {g.workers.map((w, i) => (
                        <div key={`${w.employee_code}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5 border-t">
                          <div className="min-w-0">
                            <div className="truncate"><span className="font-mono text-xs text-muted-foreground mr-1.5">{w.employee_code}</span>{w.employee_name}</div>
                            <div className="text-xs text-muted-foreground truncate">{w.shift || "—"} · {w.hours != null ? `${w.hours.toFixed(1)} h` : "—"} · {workTypeLabel(w.mph)}</div>
                          </div>
                          <span className="tabular-nums font-medium">{fmtMph(w.mph)}</span>
                        </div>
                      ))}
                    </Fragment>
                  ))}
                  <div className="flex justify-between gap-2 px-3 py-2 border-t bg-muted/30 font-semibold">
                    <span className="truncate">Used MPH · {workers.length} workers · <span className="font-mono font-normal text-xs">{nFull} × 12 + {workers.length - nFull} × 6</span></span>
                    <span className="tabular-nums">{fmtMph(dept.used_mph)}</span>
                  </div>
                </div>
                <div className="hidden md:block overflow-auto max-h-[420px]">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs">Code</TableHead>
                        <TableHead className="text-xs">Worker</TableHead>
                        <TableHead className="text-xs">Shift · time</TableHead>
                        <TableHead className="text-xs text-right">Hours</TableHead>
                        <TableHead className="text-xs">Work type</TableHead>
                        <TableHead className="text-xs text-right">MPH</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((g) => (
                        <ProcessRows key={g.process} group={g} />
                      ))}
                      <TableRow className="font-semibold bg-muted/30">
                        <TableCell colSpan={4} className="text-sm">Used MPH · {workers.length} workers</TableCell>
                        <TableCell className="text-sm font-mono whitespace-nowrap">{nFull} × 12 + {workers.length - nFull} × 6</TableCell>
                        <TableCell className="text-right text-sm">{fmtMph(dept.used_mph)}</TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
                </>
              )}
            </div>
          </div>

          {/* C · Result */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">C · Result</h4>
            <div className="rounded-md bg-muted/40 px-3 py-2 space-y-1 text-xs md:text-sm font-mono overflow-x-auto">
              <div className="md:whitespace-nowrap">
                Authorized <b>{fmtMph(dept.authorized_mph)}</b> − Used <b>{fmtMph(dept.used_mph)}</b> = Net{" "}
                <b className={netClass(dept.net_mph)}>{signed(dept.net_mph)} MPH</b> {loss ? "(loss)" : "(saved)"}
              </div>
              <div className="md:whitespace-nowrap">
                Efficiency {fmtMph(dept.authorized_mph)} ÷ {fmtMph(dept.used_mph)} ={" "}
                <b className={dept.authorized_mph >= dept.used_mph ? "text-green-600" : "text-red-600"}>{pct(dept.authorized_mph, dept.used_mph)}</b>
                {dept.output > 0 && (
                  <>
                    <span className="hidden md:inline"> · </span>
                    <span className="block md:inline">
                      Used MPH per unit {fmtMph(dept.used_mph)} ÷ {fmtQty(dept.output)} = <b>{(dept.used_mph / dept.output).toFixed(3)}</b>{" "}
                      (standard {(itemsAuth / dept.output).toFixed(3)})
                    </span>
                  </>
                )}
              </div>
              {rt && (
                <div className="flex flex-wrap items-center gap-2 pt-1 font-sans">
                  <Badge className={`${toneClass[rt.tone]} text-[11px]`}>{rt.text}</Badge>
                  <Link to={`/labour/mph-loss-reasons?date=${date}`} className="text-xs text-primary hover:underline">
                    Open MPH Loss Reasons ›
                  </Link>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function SubGroupRows({ sub, rows }: { sub: string; rows: DepartmentMphDetail["items"] }) {
  const qty = rows.reduce((s, it) => s + it.output, 0);
  const auth = round1(rows.reduce((s, it) => s + it.output * it.mph_number, 0));
  return (
    <>
      {rows.map((it, i) => (
        <TableRow key={i}>
          <TableCell className="text-sm">
            {it.item_name}{it.item_code && it.item_code !== it.item_name ? <span className="text-muted-foreground"> · {it.item_code}</span> : null}
            {it.id && <EditedBadge entry={it as { id: string; edit_count?: number | null }} compact className="ml-1.5 align-middle" />}
          </TableCell>
          <TableCell className="text-sm">{it.sub_department}</TableCell>
          <TableCell className="text-sm">{it.shift || "—"}</TableCell>
          <TableCell className="text-right text-sm">{fmtQty(it.output)}</TableCell>
          <TableCell className="text-right text-sm font-mono whitespace-nowrap">× {it.mph_number.toFixed(3)}</TableCell>
          <TableCell className="text-right text-sm">{fmtMph(it.authorized)}</TableCell>
        </TableRow>
      ))}
      {rows.length > 1 && sub !== "—" && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={3} className="text-sm font-medium">{sub} subtotal</TableCell>
          <TableCell className="text-right text-sm font-medium">{fmtQty(qty)}</TableCell>
          <TableCell />
          <TableCell className="text-right text-sm font-medium">{fmtMph(auth)}</TableCell>
        </TableRow>
      )}
    </>
  );
}

function ProcessRows({ group }: { group: ProcessGroup }) {
  return (
    <>
      <TableRow className="bg-muted/30">
        <TableCell colSpan={6} className="text-xs uppercase tracking-wide text-muted-foreground py-1">{group.process}</TableCell>
      </TableRow>
      {group.workers.map((w, i) => (
        <TableRow key={`${w.employee_code}-${i}`}>
          <TableCell className="text-sm font-mono">{w.employee_code}</TableCell>
          <TableCell className="text-sm">{w.employee_name}</TableCell>
          <TableCell className="text-sm whitespace-nowrap">{w.shift || "—"}</TableCell>
          <TableCell className="text-right text-sm">{w.hours != null ? w.hours.toFixed(1) : "—"}</TableCell>
          <TableCell className="text-sm">{workTypeLabel(w.mph)}</TableCell>
          <TableCell className="text-right text-sm">{fmtMph(w.mph)}</TableCell>
        </TableRow>
      ))}
      <TableRow className="bg-muted/30">
        <TableCell colSpan={4} className="text-sm font-medium">
          {group.process} · {group.workers.length} workers ({group.full} full, {group.half} half)
        </TableCell>
        <TableCell />
        <TableCell className="text-right text-sm font-medium">{fmtMph(group.mph)}</TableCell>
      </TableRow>
    </>
  );
}
