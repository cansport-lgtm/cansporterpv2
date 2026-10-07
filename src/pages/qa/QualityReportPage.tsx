import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileBarChart, Printer, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { printDocument, esc } from "@/lib/printDocument";
import { fetchStages, fetchThresholds, fetchEntriesAsOf, latestPerStage, statusFromUtil, fmtNum } from "@/pages/wip/wipShared";
import cansportLogo from "@/assets/cansport-logo.png";

// Daily Quality Report — one printable summary for the morning quality meeting:
// inspections (with plan target and NCR/CAPA), WIP status, and rejections /
// wastages / leakages for the selected period.

// rw_leakages is not in the generated types yet, so the untyped client is used throughout.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as any;

type RWRow = {
  id: string;
  department_id: string | null;
  reason_id: string | null;
  unit: string | null;
  total_cost: number | null;
  material_id?: string | null;
} & Record<string, unknown>;
type Named = { id: string; name: string };

const logoUrl =
  typeof window !== "undefined" ? new URL(cansportLogo, window.location.origin).href : cansportLogo;

type RWType = "rejection" | "wastage" | "leakage";
const RW_TABLES: { type: RWType; table: string; qtyCol: string; label: string }[] = [
  { type: "rejection", table: "rw_rejections", qtyCol: "rejected_qty", label: "Rejections" },
  { type: "wastage", table: "rw_wastages", qtyCol: "wasted_qty", label: "Wastages" },
  { type: "leakage", table: "rw_leakages", qtyCol: "leaked_qty", label: "Leakages" },
];

const fmtDate = (d?: string | null) => {
  if (!d) return "—";
  try { return format(parseISO(d), "dd MMM yyyy"); } catch { return String(d); }
};
const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");
const money = (n: number) => `Rs. ${Math.round(n).toLocaleString()}`;

// Quantities are entered in mixed units (pcs / kg / ltr), so they are never summed across units.
type QtyByUnit = Record<string, number>;
const addQty = (m: QtyByUnit, unit: string | null, qty: number) => {
  const u = unit || "pcs";
  m[u] = (m[u] || 0) + qty;
};
const fmtQty = (m: QtyByUnit) => {
  const parts = Object.entries(m)
    .filter(([, v]) => v)
    .sort((a, b) => b[1] - a[1])
    .map(([u, v]) => `${fmtNum(v)} ${u}`);
  return parts.length ? parts.join(" · ") : "0";
};

interface ReportData {
  inspections: { result: string; process_id: string | null; department_id: string | null }[];
  planTarget: number;
  ncrRaised: { severity: string | null; status: string | null }[];
  openNcrs: number;
  pendingCapas: number;
  wip: {
    stage: string;
    wip: number;
    threshold: number;
    unit: string;
    util: number;
    status: string;
    lastDate: string | null;
  }[];
  rw: Record<RWType, RWRow[]>;
}

export default function QualityReportPage() {
  const today = format(new Date(), "yyyy-MM-dd");
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);

  const setDay = (d: string) => {
    setFromDate(d);
    setToDate(d);
  };

  // Lookups
  const { data: lookups } = useQuery({
    queryKey: ["qreport-lookups"],
    queryFn: async () => {
      const [processes, depts, reasons, rwMaterials, hpMaterials] = await Promise.all([
        sb.from("qa_processes").select("id, name, sequence_order"),
        sb.from("production_departments").select("id, name"),
        sb.from("rw_reasons").select("id, name"),
        sb.from("rw_materials").select("id, hp_material_id"),
        sb.from("hp_materials").select("id, name"),
      ]);
      for (const r of [processes, depts, reasons, rwMaterials, hpMaterials]) if (r.error) throw r.error;
      const hpById = new Map<string, string>((hpMaterials.data as Named[] || []).map((m) => [m.id, m.name]));
      const materialName: Record<string, string> = {};
      // Legacy leakage rows point straight at hp_materials; newer ones at the R&W material master.
      (hpMaterials.data as Named[] || []).forEach((m) => { materialName[m.id] = m.name; });
      (rwMaterials.data as { id: string; hp_material_id: string }[] || []).forEach((m) => {
        const n = hpById.get(m.hp_material_id);
        if (n) materialName[m.id] = n;
      });
      return {
        processes: (processes.data || []) as { id: string; name: string; sequence_order: number | null }[],
        deptName: Object.fromEntries((depts.data as Named[] || []).map((d) => [d.id, d.name])) as Record<string, string>,
        reasonName: Object.fromEntries((reasons.data as Named[] || []).map((r) => [r.id, r.name])) as Record<string, string>,
        materialName,
      };
    },
  });

  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["qreport-data", fromDate, toDate],
    enabled: !!fromDate && !!toDate && fromDate <= toDate,
    queryFn: async (): Promise<ReportData> => {
      const [inspections, plans, ncrRaised, openNcrs, pendingCapas, stages, thresholds, wipEntries, ...rw] =
        await Promise.all([
          fetchAllRows<ReportData["inspections"][number]>((f, t) =>
            sb.from("qa_inspections")
              .select("id, result, process_id, department_id")
              .gte("inspection_date", fromDate)
              .lte("inspection_date", toDate)
              .order("id")
              .range(f, t)),
          sb.from("qa_daily_plans")
            .select("id, qa_daily_plan_items(target_inspections)")
            .gte("plan_date", fromDate)
            .lte("plan_date", toDate),
          sb.from("qa_ncr").select("severity, status").gte("ncr_date", fromDate).lte("ncr_date", toDate),
          sb.from("qa_ncr").select("id", { count: "exact", head: true }).neq("status", "closed"),
          sb.from("qa_capa").select("id", { count: "exact", head: true }).not("status", "in", "(closed,approved)"),
          fetchStages(true),
          fetchThresholds(),
          fetchEntriesAsOf(toDate),
          ...RW_TABLES.map((r) =>
            fetchAllRows<RWRow>((f, t) =>
              sb.from(r.table)
                .select(`id, department_id, reason_id, unit, total_cost, ${r.qtyCol}${r.type === "leakage" ? ", material_id" : ""}`)
                .gte("entry_date", fromDate)
                .lte("entry_date", toDate)
                .order("id")
                .range(f, t))),
        ]);
      for (const r of [plans, ncrRaised, openNcrs, pendingCapas]) if (r.error) throw r.error;

      const planTarget = (plans.data as { qa_daily_plan_items: { target_inspections: number | null }[] | null }[] || []).reduce(
        (sum, p) =>
          sum + (p.qa_daily_plan_items || []).reduce((s, i) => s + Number(i.target_inspections || 0), 0),
        0,
      );

      // WIP is a snapshot: each stage's latest entry on or before the report's end date.
      const latest = latestPerStage(wipEntries);
      const wip = stages.map((s) => {
        const e = latest.get(s.id);
        const th = thresholds.find((x) => x.stage_id === s.id);
        const qty = e ? Number(e.quantity) : 0;
        const threshold = th ? Number(th.max_threshold) : 0;
        const util = threshold > 0 ? (qty / threshold) * 100 : 0;
        return {
          stage: s.name,
          wip: qty,
          threshold,
          unit: th?.unit || s.unit || "dozens",
          util,
          status: threshold > 0 ? statusFromUtil(util).label : "No limit",
          lastDate: e?.entry_date ?? null,
        };
      });

      return {
        inspections,
        planTarget,
        ncrRaised: ncrRaised.data || [],
        openNcrs: openNcrs.count || 0,
        pendingCapas: pendingCapas.count || 0,
        wip,
        rw: { rejection: rw[0], wastage: rw[1], leakage: rw[2] },
      };
    },
  });

  // ---------- Derived summaries ----------
  const summary = useMemo(() => {
    if (!data || !lookups) return null;
    const insp = data.inspections;
    const total = insp.length;
    const passed = insp.filter((i) => i.result === "pass").length;
    const failed = insp.filter((i) => i.result === "fail").length;
    const held = insp.filter((i) => i.result === "hold").length;

    const processOrder = new Map(lookups.processes.map((p) => [p.id, p]));
    const byProcessMap: Record<string, { name: string; order: number; total: number; pass: number; fail: number; hold: number }> = {};
    insp.forEach((i) => {
      const k = i.process_id || "none";
      const p = i.process_id ? processOrder.get(i.process_id) : undefined;
      byProcessMap[k] ||= { name: p?.name || "Unassigned", order: p?.sequence_order ?? 9999, total: 0, pass: 0, fail: 0, hold: 0 };
      const row = byProcessMap[k];
      row.total += 1;
      if (i.result === "pass") row.pass += 1;
      else if (i.result === "fail") row.fail += 1;
      else if (i.result === "hold") row.hold += 1;
    });
    const byProcess = Object.values(byProcessMap).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));

    const ncrBySeverity: Record<string, number> = {};
    data.ncrRaised.forEach((n) => { const s = n.severity || "unspecified"; ncrBySeverity[s] = (ncrBySeverity[s] || 0) + 1; });

    // Rejections / wastages / leakages
    const rwTotals = RW_TABLES.map((r) => {
      const rows = data.rw[r.type];
      const qty: QtyByUnit = {};
      let cost = 0;
      rows.forEach((x) => { addQty(qty, x.unit, Number(x[r.qtyCol] || 0)); cost += Number(x.total_cost || 0); });
      return { ...r, qty, cost, entries: rows.length };
    });

    const deptMap: Record<string, { name: string; rejection: QtyByUnit; wastage: QtyByUnit; leakage: QtyByUnit; cost: number }> = {};
    RW_TABLES.forEach((r) => {
      data.rw[r.type].forEach((x) => {
        const k = x.department_id || "none";
        deptMap[k] ||= { name: lookups.deptName[k] || "Unassigned", rejection: {}, wastage: {}, leakage: {}, cost: 0 };
        addQty(deptMap[k][r.type], x.unit, Number(x[r.qtyCol] || 0));
        deptMap[k].cost += Number(x.total_cost || 0);
      });
    });
    const rwByDept = Object.values(deptMap).sort((a, b) => b.cost - a.cost);

    const reasonMap: Record<string, { reason: string; type: string; qty: QtyByUnit; cost: number }> = {};
    RW_TABLES.forEach((r) => {
      data.rw[r.type].forEach((x) => {
        const k = `${r.type}:${x.reason_id || "none"}`;
        reasonMap[k] ||= { reason: lookups.reasonName[x.reason_id ?? ""] || "No reason", type: r.label, qty: {}, cost: 0 };
        addQty(reasonMap[k].qty, x.unit, Number(x[r.qtyCol] || 0));
        reasonMap[k].cost += Number(x.total_cost || 0);
      });
    });
    const topReasons = Object.values(reasonMap).sort((a, b) => b.cost - a.cost).slice(0, 8);

    const matMap: Record<string, { material: string; qty: QtyByUnit; cost: number }> = {};
    data.rw.leakage.forEach((x) => {
      const k = x.material_id || "none";
      matMap[k] ||= { material: lookups.materialName[k] || "—", qty: {}, cost: 0 };
      addQty(matMap[k].qty, x.unit, Number(x.leaked_qty || 0));
      matMap[k].cost += Number(x.total_cost || 0);
    });
    const topLeakMaterials = Object.values(matMap).sort((a, b) => b.cost - a.cost).slice(0, 8);

    const wipTotalByUnit: QtyByUnit = {};
    data.wip.forEach((w) => addQty(wipTotalByUnit, w.unit, w.wip));
    const wipCounts = {
      healthy: data.wip.filter((w) => w.status === "Healthy").length,
      warning: data.wip.filter((w) => w.status === "Warning").length,
      bottleneck: data.wip.filter((w) => w.status === "Bottleneck").length,
    };

    return {
      total, passed, failed, held, byProcess, ncrBySeverity,
      rwTotals, rwByDept, topReasons, topLeakMaterials, wipTotalByUnit, wipCounts,
    };
  }, [data, lookups]);

  const periodLabel = fromDate === toDate ? fmtDate(fromDate) : `${fmtDate(fromDate)} – ${fmtDate(toDate)}`;

  // ---------- Print ----------
  const handlePrint = () => {
    if (!data || !summary) return;
    const s = summary;
    const kpi = (label: string, value: string) =>
      `<div class="kpi"><div class="label">${esc(label)}</div><div class="kv">${esc(value)}</div></div>`;

    const body = `
      <style>
        .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
        .kpi { flex: 1 1 110px; border: 1px solid #ccc; border-radius: 4px; padding: 6px 8px; }
        .kv { font-size: 15px; font-weight: 700; }
        h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 1px solid #999; }
        .sect { page-break-inside: avoid; }
        .bad { color: #b91c1c; font-weight: 700; } .warn { color: #b45309; font-weight: 700; } .ok { color: #15803d; }
      </style>
      <div class="wrap">
        <div class="head">
          <div class="brand">
            <img src="${esc(logoUrl)}" alt="Cansport" />
            <div><h1>DAILY QUALITY REPORT</h1><div class="xs muted">Quality Assurance — meeting summary</div></div>
          </div>
          <div class="right">
            <div class="bold">${esc(periodLabel)}</div>
            <div class="xs muted">Printed ${esc(format(new Date(), "dd MMM yyyy, HH:mm"))}</div>
          </div>
        </div>

        <div class="sect">
          <h2>1. Inspections</h2>
          <div class="kpis">
            ${kpi("Total", String(s.total))}
            ${kpi("Pass", String(s.passed))}
            ${kpi("Fail", String(s.failed))}
            ${kpi("Hold", String(s.held))}
            ${kpi("Pass rate", pct(s.passed, s.total))}
            ${kpi("Plan target", data.planTarget ? `${data.planTarget} (${pct(s.total, data.planTarget)} done)` : "No plan")}
          </div>
          <div class="kpis">
            ${kpi("NCRs raised", String(data.ncrRaised.length))}
            ${kpi("Open NCRs (all)", String(data.openNcrs))}
            ${kpi("Pending CAPAs (all)", String(data.pendingCapas))}
          </div>
          ${s.byProcess.length ? `
          <table>
            <thead><tr><th>Process</th><th class="num">Total</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Hold</th><th class="num">Pass %</th></tr></thead>
            <tbody>${s.byProcess.map((p) => `
              <tr><td>${esc(p.name)}</td><td class="num">${p.total}</td><td class="num">${p.pass}</td>
              <td class="num ${p.fail ? "bad" : ""}">${p.fail}</td><td class="num ${p.hold ? "warn" : ""}">${p.hold}</td>
              <td class="num">${pct(p.pass, p.total)}</td></tr>`).join("")}
            </tbody>
            <tfoot><tr><td>Total</td><td class="num">${s.total}</td><td class="num">${s.passed}</td><td class="num">${s.failed}</td><td class="num">${s.held}</td><td class="num">${pct(s.passed, s.total)}</td></tr></tfoot>
          </table>` : `<div class="muted">No inspections recorded.</div>`}
        </div>

        <div class="sect">
          <h2>2. WIP Status <span class="xs muted">(as of ${esc(fmtDate(toDate))})</span></h2>
          <div class="kpis">
            ${kpi("Total WIP", fmtQty(s.wipTotalByUnit))}
            ${kpi("Healthy", String(s.wipCounts.healthy))}
            ${kpi("Warning", String(s.wipCounts.warning))}
            ${kpi("Bottleneck", String(s.wipCounts.bottleneck))}
          </div>
          ${data.wip.length ? `
          <table>
            <thead><tr><th>Stage</th><th class="num">WIP</th><th class="num">Max limit</th><th class="num">Utilisation</th><th>Status</th><th>Last updated</th></tr></thead>
            <tbody>${data.wip.map((w) => `
              <tr><td>${esc(w.stage)}</td><td class="num">${esc(fmtNum(w.wip))} ${esc(w.unit)}</td>
              <td class="num">${w.threshold ? esc(fmtNum(w.threshold)) : "—"}</td>
              <td class="num">${w.threshold ? `${w.util.toFixed(0)}%` : "—"}</td>
              <td class="${w.status === "Bottleneck" ? "bad" : w.status === "Warning" ? "warn" : "ok"}">${esc(w.status)}</td>
              <td>${esc(fmtDate(w.lastDate))}</td></tr>`).join("")}
            </tbody>
          </table>` : `<div class="muted">No WIP stages configured.</div>`}
        </div>

        <div class="sect">
          <h2>3. Rejections, Wastages &amp; Leakages</h2>
          <table>
            <thead><tr><th>Type</th><th class="num">Entries</th><th class="num">Quantity</th><th class="num">Cost</th></tr></thead>
            <tbody>${s.rwTotals.map((r) => `
              <tr><td>${esc(r.label)}</td><td class="num">${r.entries}</td><td class="num">${esc(fmtQty(r.qty))}</td><td class="num">${esc(money(r.cost))}</td></tr>`).join("")}
            </tbody>
            <tfoot><tr><td>Total</td><td class="num">${s.rwTotals.reduce((a, r) => a + r.entries, 0)}</td><td></td><td class="num">${esc(money(s.rwTotals.reduce((a, r) => a + r.cost, 0)))}</td></tr></tfoot>
          </table>
          ${s.rwByDept.length ? `
          <div class="section-title">By department</div>
          <table>
            <thead><tr><th>Department</th><th class="num">Rejection</th><th class="num">Wastage</th><th class="num">Leakage</th><th class="num">Cost</th></tr></thead>
            <tbody>${s.rwByDept.map((d) => `
              <tr><td>${esc(d.name)}</td><td class="num">${esc(fmtQty(d.rejection))}</td><td class="num">${esc(fmtQty(d.wastage))}</td>
              <td class="num">${esc(fmtQty(d.leakage))}</td><td class="num">${esc(money(d.cost))}</td></tr>`).join("")}
            </tbody>
          </table>` : ""}
          ${s.topReasons.length ? `
          <div class="section-title">Top reasons</div>
          <table>
            <thead><tr><th>Reason</th><th>Type</th><th class="num">Quantity</th><th class="num">Cost</th></tr></thead>
            <tbody>${s.topReasons.map((r) => `
              <tr><td>${esc(r.reason)}</td><td>${esc(r.type)}</td><td class="num">${esc(fmtQty(r.qty))}</td><td class="num">${esc(money(r.cost))}</td></tr>`).join("")}
            </tbody>
          </table>` : ""}
          ${s.topLeakMaterials.length ? `
          <div class="section-title">Top leakage materials</div>
          <table>
            <thead><tr><th>Material</th><th class="num">Quantity</th><th class="num">Cost</th></tr></thead>
            <tbody>${s.topLeakMaterials.map((m) => `
              <tr><td>${esc(m.material)}</td><td class="num">${esc(fmtQty(m.qty))}</td><td class="num">${esc(money(m.cost))}</td></tr>`).join("")}
            </tbody>
          </table>` : ""}
        </div>

        <div class="section-title">Meeting notes / actions</div>
        <div style="border:1px solid #ccc;border-radius:4px;height:110px"></div>

        <div class="sign">
          <div>Prepared by (QA)</div>
          <div>Reviewed by (Production)</div>
          <div>Approved by (Manager)</div>
        </div>
      </div>`;

    printDocument(`Quality Report ${periodLabel}`, body);
  };

  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const invalidRange = fromDate > toDate;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Quality Report"
          description="Daily summary of inspections, WIP status, rejections and leakages — print it for the quality meeting"
          icon={FileBarChart}
        />

        <Card>
          <CardContent className="pt-4 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} max={today} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} max={today} onChange={(e) => setToDate(e.target.value)} className="w-40" />
            </div>
            <Button variant={fromDate === today && toDate === today ? "default" : "outline"} size="sm" onClick={() => setDay(today)}>
              Today
            </Button>
            <Button variant={fromDate === yesterday && toDate === yesterday ? "default" : "outline"} size="sm" onClick={() => setDay(yesterday)}>
              Yesterday
            </Button>
            <div className="flex gap-2 ml-auto">
              <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching || invalidRange}>
                <RefreshCw className={cn("mr-2 h-4 w-4", isFetching && "animate-spin")} />
                Refresh
              </Button>
              <Button size="sm" onClick={handlePrint} disabled={!summary || isFetching || invalidRange}>
                <Printer className="mr-2 h-4 w-4" />
                Print Report
              </Button>
            </div>
            {invalidRange && <p className="w-full text-sm text-destructive">"From" date must be on or before "To" date.</p>}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-destructive">Could not load the report: {(error as Error).message}</p>}
        {(isLoading || !summary) && !error && !invalidRange && <p className="text-sm text-muted-foreground">Loading report…</p>}

        {summary && data && (
          <>
            {/* 1. Inspections */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">1. Inspections — {periodLabel}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <Kpi label="Total" value={summary.total} />
                  <Kpi label="Pass" value={summary.passed} accent="text-emerald-600" />
                  <Kpi label="Fail" value={summary.failed} accent={summary.failed ? "text-red-600" : undefined} />
                  <Kpi label="Hold" value={summary.held} accent={summary.held ? "text-amber-600" : undefined} />
                  <Kpi label="Pass rate" value={pct(summary.passed, summary.total)} />
                  <Kpi
                    label="Plan target"
                    value={data.planTarget || "No plan"}
                    sub={data.planTarget ? `${pct(summary.total, data.planTarget)} done` : undefined}
                  />
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <Kpi
                    label="NCRs raised"
                    value={data.ncrRaised.length}
                    sub={Object.entries(summary.ncrBySeverity).map(([k, v]) => `${k}: ${v}`).join(", ") || undefined}
                  />
                  <Kpi label="Open NCRs (all)" value={data.openNcrs} />
                  <Kpi label="Pending CAPAs (all)" value={data.pendingCapas} />
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Process</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Pass</TableHead>
                        <TableHead className="text-right">Fail</TableHead>
                        <TableHead className="text-right">Hold</TableHead>
                        <TableHead className="text-right">Pass %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {summary.byProcess.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No inspections recorded</TableCell></TableRow>
                      )}
                      {summary.byProcess.map((p) => (
                        <TableRow key={p.name}>
                          <TableCell>{p.name}</TableCell>
                          <TableCell className="text-right">{p.total}</TableCell>
                          <TableCell className="text-right">{p.pass}</TableCell>
                          <TableCell className={cn("text-right", p.fail > 0 && "text-red-600 font-semibold")}>{p.fail}</TableCell>
                          <TableCell className={cn("text-right", p.hold > 0 && "text-amber-600 font-semibold")}>{p.hold}</TableCell>
                          <TableCell className="text-right">{pct(p.pass, p.total)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* 2. WIP */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">2. WIP Status — as of {fmtDate(toDate)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <Kpi label="Total WIP" value={fmtQty(summary.wipTotalByUnit)} />
                  <Kpi label="Healthy" value={summary.wipCounts.healthy} accent="text-emerald-600" />
                  <Kpi label="Warning" value={summary.wipCounts.warning} accent={summary.wipCounts.warning ? "text-amber-600" : undefined} />
                  <Kpi label="Bottleneck" value={summary.wipCounts.bottleneck} accent={summary.wipCounts.bottleneck ? "text-red-600" : undefined} />
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">WIP</TableHead>
                        <TableHead className="text-right">Max limit</TableHead>
                        <TableHead className="text-right">Utilisation</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Last updated</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.wip.length === 0 && (
                        <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No WIP stages configured</TableCell></TableRow>
                      )}
                      {data.wip.map((w) => (
                        <TableRow key={w.stage}>
                          <TableCell>{w.stage}</TableCell>
                          <TableCell className="text-right">{fmtNum(w.wip)} {w.unit}</TableCell>
                          <TableCell className="text-right">{w.threshold ? fmtNum(w.threshold) : "—"}</TableCell>
                          <TableCell className="text-right">{w.threshold ? `${w.util.toFixed(0)}%` : "—"}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                w.status === "Bottleneck" && "border-red-500 text-red-600",
                                w.status === "Warning" && "border-amber-500 text-amber-600",
                                w.status === "Healthy" && "border-emerald-500 text-emerald-600",
                              )}
                            >
                              {w.status}
                            </Badge>
                          </TableCell>
                          <TableCell className={cn(w.lastDate && w.lastDate < toDate && "text-amber-600")}>
                            {fmtDate(w.lastDate)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* 3. Rejections / wastages / leakages */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">3. Rejections, Wastages &amp; Leakages — {periodLabel}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {summary.rwTotals.map((r) => (
                    <Kpi key={r.type} label={r.label} value={fmtQty(r.qty)} sub={`${money(r.cost)} · ${r.entries} entries`} />
                  ))}
                </div>

                <SubTable
                  title="By department"
                  head={["Department", "Rejection", "Wastage", "Leakage", "Cost"]}
                  rows={summary.rwByDept.map((d) => [d.name, fmtQty(d.rejection), fmtQty(d.wastage), fmtQty(d.leakage), money(d.cost)])}
                />
                <div className="grid gap-6 lg:grid-cols-2">
                  <SubTable
                    title="Top reasons"
                    head={["Reason", "Type", "Quantity", "Cost"]}
                    rows={summary.topReasons.map((r) => [r.reason, r.type, fmtQty(r.qty), money(r.cost)])}
                    numericFrom={2}
                  />
                  <SubTable
                    title="Top leakage materials"
                    head={["Material", "Quantity", "Cost"]}
                    rows={summary.topLeakMaterials.map((m) => [m.material, fmtQty(m.qty), money(m.cost)])}
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ERPLayout>
  );
}

function Kpi({ label, value, sub, accent }: { label: string; value: number | string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 min-w-0">
      <div className="text-xs text-muted-foreground truncate">{label}</div>
      <div className={cn("text-lg font-semibold break-words", accent)}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5 leading-tight break-words">{sub}</div>}
    </div>
  );
}

// Small summary table; columns from `numericFrom` onwards are right-aligned.
function SubTable({ title, head, rows, numericFrom = 1 }: { title: string; head: string[]; rows: string[][]; numericFrom?: number }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {head.map((h, i) => (
                <TableHead key={h} className={cn(i >= numericFrom && "text-right")}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={head.length} className="text-center text-muted-foreground">No entries</TableCell></TableRow>
            )}
            {rows.map((r, ri) => (
              <TableRow key={ri}>
                {r.map((c, i) => (
                  <TableCell key={i} className={cn(i >= numericFrom && "text-right")}>{c}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
