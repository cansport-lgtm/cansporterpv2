// Single Day view of the Material Usage Report for several materials at once.
// One comparison row per material for the chosen date. Materials can be in
// different units (kg / ltr / pcs), so quantities are only ever totalled
// within a unit; the cross-material headline is the unit-free variance %.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart3, ChevronDown, ChevronRight, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { buildMultiMaterialUsageReportPdf } from "@/lib/materialUsageReportPdf";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

export interface ReportMaterial {
  id: string;
  code: string;
  name: string;
  unit: string | null;
}

interface BomBreakdownItem {
  productId: string;
  productName: string;
  produced: number;
  bomRate: number;
  subtotal: number;
  departmentName: string;
}

export interface MultiMaterialRow {
  id: string;
  code: string;
  name: string;
  unit: string;
  opening: number;
  receipts: number;
  actual: number;
  standard: number;
  variance: number;
  variancePct: number;
  closing: number;
  bomBreakdown: BomBreakdownItem[];
}

export interface UnitTotal {
  unit: string;
  count: number;
  actual: number;
  standard: number;
  variance: number;
  variancePct: number;
}

export interface MultiDepartmentUsage {
  unit: string;
  departmentName: string;
  produced: number;
  standard: number;
  actualEst: number;
  pctOfTotal: number;
}

export interface MultiMaterialReport {
  rows: MultiMaterialRow[];
  unitTotals: UnitTotal[];
  departmentUsage: MultiDepartmentUsage[];
  overCount: number;
  underCount: number;
  avgVariancePct: number;
  isLoading: boolean;
}

function pctOf(actual: number, standard: number): number {
  return standard > 0 ? ((actual - standard) / standard) * 100 : actual > 0 ? 100 : 0;
}

function signed(n: number, digits = 2): string {
  return (n > 0 ? "+" : "") + n.toFixed(digits);
}

function hasActivity(r: MultiMaterialRow): boolean {
  return r.opening > 0 || r.receipts > 0 || r.actual > 0 || r.standard > 0 || r.closing > 0;
}

export function useMultiMaterialSingleDayReport({
  materialIds,
  materials,
  date,
  productLookup,
  productDepartmentLookup,
  departmentNameLookup,
  hideInactive,
}: {
  materialIds: string[];
  materials: ReportMaterial[] | undefined;
  date: Date;
  productLookup: Record<string, string>;
  productDepartmentLookup: Record<string, string | null>;
  departmentNameLookup: Record<string, string>;
  hideInactive: boolean;
}): MultiMaterialReport {
  const enabled = materialIds.length > 0;
  const dateStr = format(date, "yyyy-MM-dd");

  // Whole-day pulls filtered client-side: one closing row per material per day
  // keeps this small, and avoids a huge `.in(...)` URL when a full tier is picked.
  const { data: closings, isLoading: closingsLoading } = useQuery({
    queryKey: ["consumption-usage-multi-closing", dateStr],
    queryFn: () =>
      fetchAllRows<{
        raw_material_id: string;
        actual_consumption: number | null;
        opening_quantity: number | null;
        receipt_quantity: number | null;
        closing_quantity: number | null;
      }>((from, to) =>
        supabase
          .from("consumption_stock_closing")
          .select("raw_material_id, actual_consumption, opening_quantity, receipt_quantity, closing_quantity")
          .eq("closing_date", dateStr)
          .order("id")
          .range(from, to)
      ),
    enabled,
  });

  const { data: bom, isLoading: bomLoading } = useQuery({
    queryKey: ["consumption-usage-multi-bom"],
    queryFn: () =>
      fetchAllRows<{ product_id: string; raw_material_id: string; standard_quantity: number }>((from, to) =>
        supabase
          .from("consumption_bom")
          .select("product_id, raw_material_id, standard_quantity")
          .eq("is_active", true)
          .order("id")
          .range(from, to)
      ),
    enabled,
  });

  const { data: production, isLoading: productionLoading } = useQuery({
    queryKey: ["consumption-usage-multi-production", dateStr],
    queryFn: () =>
      fetchAllRows<{ product_id: string; quantity_produced: number }>((from, to) =>
        supabase
          .from("consumption_production_entry")
          .select("product_id, quantity_produced")
          .eq("entry_date", dateStr)
          .order("id")
          .range(from, to)
      ),
    enabled,
  });

  return useMemo(() => {
    const empty: MultiMaterialReport = {
      rows: [], unitTotals: [], departmentUsage: [], overCount: 0, underCount: 0, avgVariancePct: 0,
      isLoading: enabled && (closingsLoading || bomLoading || productionLoading),
    };
    if (!enabled || !materials || !closings || !bom || !production) return empty;

    const closingByMaterial = new Map(closings.map((c) => [c.raw_material_id, c]));
    const bomByMaterial = new Map<string, Map<string, number>>();
    bom.forEach((b) => {
      if (!bomByMaterial.has(b.raw_material_id)) bomByMaterial.set(b.raw_material_id, new Map());
      bomByMaterial.get(b.raw_material_id)!.set(b.product_id, Number(b.standard_quantity));
    });
    const producedByProduct = new Map<string, number>();
    production.forEach((p) => {
      producedByProduct.set(p.product_id, (producedByProduct.get(p.product_id) || 0) + Number(p.quantity_produced));
    });

    const materialById = new Map(materials.map((m) => [m.id, m]));
    let rows: MultiMaterialRow[] = materialIds
      .map((id) => materialById.get(id))
      .filter((m): m is ReportMaterial => !!m)
      .map((m) => {
        const closing = closingByMaterial.get(m.id);
        const actual = Number(closing?.actual_consumption || 0);
        const bomRates = bomByMaterial.get(m.id);
        let standard = 0;
        const bomBreakdown: BomBreakdownItem[] = [];
        producedByProduct.forEach((produced, productId) => {
          const rate = bomRates?.get(productId);
          if (rate === undefined) return;
          const subtotal = rate * produced;
          standard += subtotal;
          const deptId = productDepartmentLookup[productId];
          bomBreakdown.push({
            productId,
            productName: productLookup[productId] || productId,
            produced,
            bomRate: rate,
            subtotal,
            departmentName: deptId ? (departmentNameLookup[deptId] || "Unassigned") : "Unassigned",
          });
        });
        return {
          id: m.id,
          code: m.code,
          name: m.name,
          unit: m.unit || "kg",
          opening: Number(closing?.opening_quantity || 0),
          receipts: Number(closing?.receipt_quantity || 0),
          actual,
          standard,
          variance: actual - standard,
          variancePct: pctOf(actual, standard),
          closing: Number(closing?.closing_quantity || 0),
          bomBreakdown,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

    if (hideInactive) rows = rows.filter(hasActivity);

    const unitMap = new Map<string, UnitTotal>();
    rows.forEach((r) => {
      const t = unitMap.get(r.unit) || { unit: r.unit, count: 0, actual: 0, standard: 0, variance: 0, variancePct: 0 };
      t.count += 1;
      t.actual += r.actual;
      t.standard += r.standard;
      unitMap.set(r.unit, t);
    });
    const unitTotals = Array.from(unitMap.values())
      .map((t) => ({ ...t, variance: t.actual - t.standard, variancePct: pctOf(t.actual, t.standard) }))
      .sort((a, b) => a.unit.localeCompare(b.unit));

    // Department split: each material's actual is prorated by the department's
    // share of that material's standard, then summed within the unit.
    const deptMap = new Map<string, { unit: string; departmentName: string; products: Map<string, number>; standard: number; actualEst: number }>();
    rows.forEach((r) => {
      const ratio = r.standard > 0 ? r.actual / r.standard : 0;
      r.bomBreakdown.forEach((b) => {
        const key = `${r.unit}|${b.departmentName}`;
        const d = deptMap.get(key) || { unit: r.unit, departmentName: b.departmentName, products: new Map(), standard: 0, actualEst: 0 };
        d.products.set(b.productId, b.produced);
        d.standard += b.subtotal;
        d.actualEst += b.subtotal * ratio;
        deptMap.set(key, d);
      });
    });
    const departmentUsage = Array.from(deptMap.values())
      .map((d) => {
        const unitStandard = unitMap.get(d.unit)?.standard || 0;
        return {
          unit: d.unit,
          departmentName: d.departmentName,
          // A product consuming several selected materials is counted once.
          produced: Array.from(d.products.values()).reduce((s, n) => s + n, 0),
          standard: d.standard,
          actualEst: d.actualEst,
          pctOfTotal: unitStandard > 0 ? (d.standard / unitStandard) * 100 : 0,
        };
      })
      .sort((a, b) => a.unit.localeCompare(b.unit) || b.standard - a.standard);

    const withStandard = rows.filter((r) => r.standard > 0);
    return {
      rows,
      unitTotals,
      departmentUsage,
      overCount: rows.filter((r) => r.variance > 0).length,
      underCount: rows.filter((r) => r.variance < 0).length,
      avgVariancePct: withStandard.length > 0
        ? withStandard.reduce((s, r) => s + r.variancePct, 0) / withStandard.length
        : 0,
      isLoading: false,
    };
  }, [enabled, materials, closings, bom, production, materialIds, productLookup, productDepartmentLookup,
      departmentNameLookup, hideInactive, closingsLoading, bomLoading, productionLoading]);
}

export function buildMultiMaterialPdf(report: MultiMaterialReport, date: Date, tierLabel: string, includeBomBreakdown: boolean) {
  const blob = buildMultiMaterialUsageReportPdf({
    dateLabel: format(date, "dd MMM yyyy"),
    tierLabel,
    generatedOn: format(new Date(), "dd MMM yyyy, hh:mm a"),
    rows: report.rows,
    unitTotals: report.unitTotals,
    overCount: report.overCount,
    underCount: report.underCount,
    avgVariancePct: report.avgVariancePct,
    departmentUsage: report.departmentUsage,
    includeBomBreakdown,
  });
  const fileName = `Material-Usage-Report-Multi-${report.rows.length}items-${format(date, "yyyyMMdd")}`
    .replace(/[^\w-]+/g, "_") + ".pdf";
  return { blob, fileName };
}

export function multiMaterialShareSummary(report: MultiMaterialReport, date: Date): string {
  return (
    `*Material Usage Report — Single Day*\n` +
    `${format(date, "dd MMM yyyy")} · ${report.rows.length} materials\n` +
    `Over standard: ${report.overCount} · Under: ${report.underCount}\n\n` +
    report.unitTotals
      .map((t) => `[${t.unit}] Actual ${t.actual.toFixed(2)} · Std ${t.standard.toFixed(2)} · Var ${signed(t.variance)} (${signed(t.variancePct, 1)}%)`)
      .join("\n")
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function printMultiMaterialReport(report: MultiMaterialReport, date: Date, tierLabel: string, includeBomBreakdown: boolean) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  const varColor = (v: number) => (v > 0 ? "#dc2626" : v < 0 ? "#16a34a" : "inherit");
  const dateLabel = format(date, "dd MMM yyyy");

  const rowsHtml = report.rows.map((r) => {
    const breakdown = includeBomBreakdown && r.bomBreakdown.length > 0
      ? `<div class="breakdown">${r.bomBreakdown.map((b) => `${escapeHtml(b.productName)} (${escapeHtml(b.departmentName)}): ${b.produced} × ${b.bomRate} = ${b.subtotal.toFixed(2)}`).join("<br/>")}</div>`
      : "";
    return `<tr>
      <td>${escapeHtml(r.code)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.unit)}</td>
      <td class="n">${r.opening.toFixed(2)}</td>
      <td class="n">${r.receipts.toFixed(2)}</td>
      <td class="n">${r.actual.toFixed(2)}</td>
      <td class="n">${r.standard.toFixed(2)}${breakdown}</td>
      <td class="n" style="color:${varColor(r.variance)}">${signed(r.variance)}</td>
      <td class="n" style="${Math.abs(r.variancePct) > 10 ? "color:#dc2626;font-weight:bold" : ""}">${signed(r.variancePct, 1)}%</td>
      <td class="n">${r.closing.toFixed(2)}</td>
    </tr>`;
  }).join("") || `<tr><td colspan="10" style="text-align:center;color:#888">No consumption data found for this date</td></tr>`;

  const totalsHtml = report.unitTotals.map((t) => `<tr class="total-row">
      <td colspan="2">Total — ${t.count} item${t.count === 1 ? "" : "s"}</td>
      <td>${escapeHtml(t.unit)}</td>
      <td></td><td></td>
      <td class="n">${t.actual.toFixed(2)}</td>
      <td class="n">${t.standard.toFixed(2)}</td>
      <td class="n" style="color:${varColor(t.variance)}">${signed(t.variance)}</td>
      <td class="n">${signed(t.variancePct, 1)}%</td>
      <td></td>
    </tr>`).join("");

  const deptHtml = report.departmentUsage.length > 0
    ? report.departmentUsage.map((d) => `<tr>
        <td>${escapeHtml(d.unit)}</td>
        <td>${escapeHtml(d.departmentName)}</td>
        <td class="n">${d.produced.toFixed(2)}</td>
        <td class="n">${d.standard.toFixed(2)}</td>
        <td class="n">${d.actualEst.toFixed(2)}</td>
        <td class="n">${d.pctOfTotal.toFixed(1)}%</td>
      </tr>`).join("")
    : `<tr><td colspan="6" style="text-align:center;color:#888">No department-linked production on this date</td></tr>`;

  const unitCards = report.unitTotals.map((t) => `<div>
      <div class="label">${escapeHtml(t.unit)} — ${t.count} item${t.count === 1 ? "" : "s"}</div>
      <div class="value">${t.actual.toFixed(2)} / ${t.standard.toFixed(2)}</div>
      <div class="label" style="color:${varColor(t.variance)}">Var ${signed(t.variance)} (${signed(t.variancePct, 1)}%)</div>
    </div>`).join("");

  printWindow.document.write(`<!DOCTYPE html><html><head><title>Material Usage Report - ${dateLabel}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
      h1 { font-size: 18px; margin-bottom: 4px; }
      h2 { font-size: 14px; margin: 24px 0 8px; }
      .meta { font-size: 13px; color: #555; margin-bottom: 16px; }
      .summary { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
      .summary > div { border: 1px solid #ddd; border-radius: 6px; padding: 10px 16px; }
      .summary .label { font-size: 12px; color: #666; }
      .summary .value { font-size: 18px; font-weight: bold; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { border: 1px solid #ddd; padding: 5px 8px; vertical-align: top; }
      th { background: #f3f4f6; text-align: left; font-weight: 600; }
      .n { text-align: right; }
      .total-row { font-weight: bold; border-top: 2px solid #333; }
      .breakdown { margin-top: 4px; font-size: 10px; color: #666; text-align: left; }
      @media print { body { padding: 0; } tr { break-inside: avoid; } }
    </style>
  </head><body>
    <h1>Material Usage Report — Single Day</h1>
    <div class="meta">${dateLabel} | ${report.rows.length} material${report.rows.length === 1 ? "" : "s"} | ${escapeHtml(tierLabel)}</div>
    <div class="summary">
      <div><div class="label">Over / Under standard</div><div class="value">${report.overCount} / ${report.underCount}</div><div class="label">Avg variance ${signed(report.avgVariancePct, 1)}%</div></div>
      ${unitCards}
    </div>

    <h2>Material Comparison</h2>
    <table>
      <thead><tr>
        <th>Code</th><th>Material</th><th>Unit</th>
        <th class="n">Opening</th><th class="n">Receipts</th><th class="n">Actual</th><th class="n">Standard</th>
        <th class="n">Variance</th><th class="n">Var %</th><th class="n">Closing</th>
      </tr></thead>
      <tbody>${rowsHtml}${totalsHtml}</tbody>
    </table>

    <h2>Department-wise Usage Breakdown</h2>
    <table>
      <thead><tr>
        <th>Unit</th><th>Department</th><th class="n">Produced (units)</th><th class="n">Standard Usage</th>
        <th class="n">Actual Usage — Est.</th><th class="n">% of Unit Total</th>
      </tr></thead>
      <tbody>${deptHtml}</tbody>
    </table>
    ${report.departmentUsage.length > 0 ? `<div style="margin-top:6px;font-size:11px;color:#888;">Standard usage is exact (from BOM); Actual Usage is estimated per material by prorating its actual consumption by each department's share of its standard usage.</div>` : ""}

    <div style="margin-top:12px;font-size:11px;color:#888;">Printed on ${format(new Date(), "dd MMM yyyy, hh:mm a")}</div>
    <script>window.onload=function(){window.print();}</script>
  </body></html>`);
  printWindow.document.close();
}

const usageChartConfig = {
  actual: { label: "Actual", color: "hsl(var(--primary))" },
  standard: { label: "Standard", color: "hsl(var(--muted-foreground))" },
};

const varianceChartConfig = {
  variancePct: { label: "Variance %", color: "hsl(var(--destructive))" },
};

export function MultiMaterialSingleDayView({
  report,
  date,
  hideInactive,
  onHideInactiveChange,
  includeBomInPrint,
  onIncludeBomInPrintChange,
}: {
  report: MultiMaterialReport;
  date: Date;
  hideInactive: boolean;
  onHideInactiveChange: (v: boolean) => void;
  includeBomInPrint: boolean;
  onIncludeBomInPrintChange: (v: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const chartData = report.rows.map((r) => ({
    label: r.code,
    actual: r.actual,
    standard: r.standard,
    variancePct: Number(r.variancePct.toFixed(1)),
  }));
  const dateLabel = format(date, "dd MMM yyyy");

  return (
    <>
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{report.rows.length}</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-destructive">{report.overCount} over</span> ·{" "}
              <span className="text-green-600">{report.underCount} under</span> standard
            </p>
          </CardContent>
        </Card>
        {([
          ["Total Actual", (t: UnitTotal) => t.actual.toFixed(2), () => ""],
          ["Total Standard", (t: UnitTotal) => t.standard.toFixed(2), () => ""],
          ["Total Variance", (t: UnitTotal) => `${signed(t.variance)} (${signed(t.variancePct, 1)}%)`,
            (t: UnitTotal) => (t.variance > 0 ? "text-destructive" : t.variance < 0 ? "text-green-600" : "")],
        ] as const).map(([title, value, color]) => (
          <Card key={title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {report.unitTotals.length === 0 ? (
                <div className="text-2xl font-bold">—</div>
              ) : (
                report.unitTotals.map((t) => (
                  <div key={t.unit} className="flex items-baseline gap-2">
                    <span className={cn(report.unitTotals.length === 1 ? "text-2xl" : "text-lg", "font-bold", color(t))}>
                      {value(t)}
                    </span>
                    <span className="text-xs text-muted-foreground">{t.unit}</span>
                  </div>
                ))
              )}
              {title === "Total Variance" && (
                <p className="text-xs text-muted-foreground">Avg per material: {signed(report.avgVariancePct, 1)}%</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Actual vs Standard — {dateLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={usageChartConfig} className="h-[300px] w-full">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={11} interval={0} angle={chartData.length > 8 ? -40 : 0} textAnchor={chartData.length > 8 ? "end" : "middle"} height={chartData.length > 8 ? 60 : 30} />
                <YAxis fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Bar dataKey="actual" fill="var(--color-actual)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="standard" fill="var(--color-standard)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
            {report.unitTotals.length > 1 && (
              <p className="text-xs text-muted-foreground mt-2">Materials use different units — compare bars within the same unit.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Variance % by Material — {dateLabel}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={varianceChartConfig} className="h-[300px] w-full">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" fontSize={11} interval={0} angle={chartData.length > 8 ? -40 : 0} textAnchor={chartData.length > 8 ? "end" : "middle"} height={chartData.length > 8 ? 60 : 30} />
                <YAxis fontSize={12} unit="%" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Bar dataKey="variancePct" fill="var(--color-variancePct)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Comparison Table */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-4 space-y-0">
          <CardTitle>Material Comparison — {dateLabel}</CardTitle>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={hideInactive} onCheckedChange={(v) => onHideInactiveChange(v === true)} />
              Hide materials with no activity
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={includeBomInPrint} onCheckedChange={(v) => onIncludeBomInPrintChange(v === true)} />
              Include BOM breakdown in print / PDF
            </label>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Code</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Receipts</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">Standard</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Var %</TableHead>
                <TableHead className="text-right">Closing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground">Loading…</TableCell>
                </TableRow>
              ) : report.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-muted-foreground">
                    No consumption data found for this date
                  </TableCell>
                </TableRow>
              ) : (
                report.rows.map((r) => {
                  const isOpen = expanded.has(r.id);
                  const canExpand = r.bomBreakdown.length > 0;
                  return (
                    <Fragment key={r.id}>
                      <TableRow
                        className={cn(canExpand && "cursor-pointer")}
                        onClick={() => canExpand && toggleExpanded(r.id)}
                      >
                        <TableCell className="px-2">
                          {canExpand && (isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />)}
                        </TableCell>
                        <TableCell className="font-medium">{r.code}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell className="text-muted-foreground">{r.unit}</TableCell>
                        <TableCell className="text-right">{r.opening.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.receipts.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.actual.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{r.standard.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className={r.variance > 0 ? "text-destructive" : r.variance < 0 ? "text-green-600" : ""}>
                            {signed(r.variance)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={Math.abs(r.variancePct) > 10 ? "text-destructive font-semibold" : ""}>
                            {signed(r.variancePct, 1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{r.closing.toFixed(2)}</TableCell>
                      </TableRow>
                      {isOpen && (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell />
                          <TableCell colSpan={10} className="py-2">
                            <div className="space-y-0.5">
                              {r.bomBreakdown.map((b) => (
                                <div key={b.productId} className="text-xs text-muted-foreground">
                                  {b.productName} ({b.departmentName}): {b.produced} × {b.bomRate} = {b.subtotal.toFixed(2)} {r.unit}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
              {!report.isLoading && report.unitTotals.map((t) => (
                <TableRow key={t.unit} className="font-bold border-t-2">
                  <TableCell />
                  <TableCell colSpan={2}>Total — {t.count} item{t.count === 1 ? "" : "s"}</TableCell>
                  <TableCell>{t.unit}</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right">{t.actual.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{t.standard.toFixed(2)}</TableCell>
                  <TableCell className="text-right">
                    <span className={t.variance > 0 ? "text-destructive" : t.variance < 0 ? "text-green-600" : ""}>
                      {signed(t.variance)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">{signed(t.variancePct, 1)}%</TableCell>
                  <TableCell />
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Department-wise Usage Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Department-wise Usage Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead>
                <TableHead>Department</TableHead>
                <TableHead className="text-right">Produced (units)</TableHead>
                <TableHead className="text-right">Standard Usage</TableHead>
                <TableHead className="text-right">Actual Usage — Est.</TableHead>
                <TableHead className="text-right">% of Unit Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.departmentUsage.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No department-linked production on this date
                  </TableCell>
                </TableRow>
              ) : (
                report.departmentUsage.map((d) => (
                  <TableRow key={`${d.unit}|${d.departmentName}`}>
                    <TableCell className="text-muted-foreground">{d.unit}</TableCell>
                    <TableCell className="font-medium">{d.departmentName}</TableCell>
                    <TableCell className="text-right">{d.produced.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{d.standard.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{d.actualEst.toFixed(2)}</TableCell>
                    <TableCell className="text-right">{d.pctOfTotal.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          {report.departmentUsage.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Standard usage is exact (from BOM); Actual Usage is estimated per material by prorating its actual consumption by each department's share of its standard usage.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
