// Single Day view of the Material Usage Report for several materials at once.
// One comparison row per material for the chosen date. Materials can be in
// different units (kg / ltr / pcs), so quantities are only ever totalled
// within a unit; the cross-material headline is the unit-free variance %.

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { BarChart3, ChevronDown, ChevronRight, LayoutGrid, Table as TableIcon, TrendingUp } from "lucide-react";
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

/**
 * over / under / on: compared against a BOM standard for the day.
 * nostd: consumption recorded but no BOM-linked production, so there is no
 * standard to compare with (shown as a flag instead of a misleading +100%).
 * idle: nothing used and nothing expected.
 */
export type MaterialStatus = "over" | "under" | "on" | "nostd" | "idle";

export interface MultiMaterialRow {
  id: string;
  status: MaterialStatus;
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
  /** This material's usage split by production department, in its own unit. */
  departments: MaterialDepartmentUsage[];
}

export interface MaterialDepartmentUsage {
  departmentName: string;
  produced: number;
  standard: number;
  /** Material's actual prorated by this department's share of its standard. */
  actualEst: number;
  /** Share of this material's standard. */
  pctOfMaterial: number;
}

export interface UnitTotal {
  unit: string;
  count: number;
  actual: number;
  standard: number;
  variance: number;
  variancePct: number;
}

export interface MultiMaterialReport {
  rows: MultiMaterialRow[];
  unitTotals: UnitTotal[];
  overCount: number;
  underCount: number;
  onCount: number;
  noStandardCount: number;
  avgVariancePct: number;
  isLoading: boolean;
}

function pctOf(actual: number, standard: number): number {
  return standard > 0 ? ((actual - standard) / standard) * 100 : actual > 0 ? 100 : 0;
}

function departmentSplit(bomBreakdown: BomBreakdownItem[], actual: number, standard: number): MaterialDepartmentUsage[] {
  const ratio = standard > 0 ? actual / standard : 0;
  const map = new Map<string, MaterialDepartmentUsage>();
  bomBreakdown.forEach((b) => {
    const d = map.get(b.departmentName) || { departmentName: b.departmentName, produced: 0, standard: 0, actualEst: 0, pctOfMaterial: 0 };
    d.produced += b.produced;
    d.standard += b.subtotal;
    d.actualEst += b.subtotal * ratio;
    map.set(b.departmentName, d);
  });
  return Array.from(map.values())
    .map((d) => ({ ...d, pctOfMaterial: standard > 0 ? (d.standard / standard) * 100 : 0 }))
    .sort((a, b) => b.standard - a.standard);
}

function statusOf(actual: number, standard: number): MaterialStatus {
  if (standard <= 0) return actual > 0 ? "nostd" : "idle";
  const variance = actual - standard;
  // Round to the 2 decimals the report shows, so "+0.00" never reads as over.
  if (Math.round(variance * 100) > 0) return "over";
  if (Math.round(variance * 100) < 0) return "under";
  return "on";
}

/** Counts line used in the header, share text, print and PDF. */
export function statusSummary(report: Pick<MultiMaterialReport, "overCount" | "underCount" | "onCount" | "noStandardCount">): string {
  const parts = [
    report.overCount && `${report.overCount} over standard`,
    report.underCount && `${report.underCount} under`,
    report.onCount && `${report.onCount} on standard`,
    report.noStandardCount && `${report.noStandardCount} no standard`,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "no consumption on this date";
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
      rows: [], unitTotals: [], overCount: 0, underCount: 0, onCount: 0, noStandardCount: 0, avgVariancePct: 0,
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
          status: statusOf(actual, standard),
          closing: Number(closing?.closing_quantity || 0),
          bomBreakdown,
          departments: departmentSplit(bomBreakdown, actual, standard),
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

    const withStandard = rows.filter((r) => r.standard > 0);
    return {
      rows,
      unitTotals,
      overCount: rows.filter((r) => r.status === "over").length,
      underCount: rows.filter((r) => r.status === "under").length,
      onCount: rows.filter((r) => r.status === "on").length,
      noStandardCount: rows.filter((r) => r.status === "nostd").length,
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
    statusLine: statusSummary(report),
    rows: report.rows,
    includeBomBreakdown,
  });
  const fileName = `Material-Usage-Report-Itemwise-${report.rows.length}items-${format(date, "yyyyMMdd")}`
    .replace(/[^\w-]+/g, "_") + ".pdf";
  return { blob, fileName };
}

function statusText(r: MultiMaterialRow, unitSuffix = true): string {
  const unit = unitSuffix ? ` ${r.unit}` : "";
  switch (r.status) {
    case "over": return `${signed(r.variancePct, 1)}% (${signed(r.variance)}${unit} over)`;
    case "under": return `${signed(r.variancePct, 1)}% (${signed(r.variance)}${unit} under)`;
    case "on": return "On standard";
    case "nostd": return "No standard";
    default: return "No activity";
  }
}

export function multiMaterialShareSummary(report: MultiMaterialReport, date: Date): string {
  return (
    `*Material Usage Report — Item-wise*\n` +
    `${format(date, "dd MMM yyyy")} · ${report.rows.length} materials\n` +
    `${statusSummary(report)}\n\n` +
    report.rows
      .map((r) => `${r.code} ${r.name}: ${r.actual.toFixed(2)} / ${r.standard.toFixed(2)} ${r.unit} — ${statusText(r)}`)
      .join("\n")
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

const PRINT_STATUS: Record<MaterialStatus, { color: string; label: (r: MultiMaterialRow) => string }> = {
  over: { color: "#dc2626", label: (r) => `${signed(r.variancePct, 1)}% OVER` },
  under: { color: "#16a34a", label: (r) => `${signed(r.variancePct, 1)}% UNDER` },
  on: { color: "#374151", label: () => "ON STANDARD" },
  nostd: { color: "#d97706", label: () => "NO STANDARD" },
  idle: { color: "#9ca3af", label: () => "NO ACTIVITY" },
};

export function printMultiMaterialReport(report: MultiMaterialReport, date: Date, tierLabel: string, includeBomBreakdown: boolean) {
  const printWindow = window.open("", "_blank");
  if (!printWindow) return;
  const dateLabel = format(date, "dd MMM yyyy");

  const boxes = report.rows.map((r, i) => {
    const st = PRINT_STATUS[r.status];
    const variance = r.status === "nostd" || r.status === "idle" ? "—" : signed(r.variance);
    const bom = r.bomBreakdown.length > 0
      ? `Std: ${r.bomBreakdown.map((b) => `${escapeHtml(b.productName)} ${b.produced} × ${b.bomRate} = ${b.subtotal.toFixed(2)}`).join(" · ")}`
      : r.status === "nostd" ? "No BOM-linked production recorded for this date." : "";
    return `<div class="box" style="border-left-color:${st.color}">
      <div class="t"><span>${i + 1}. ${escapeHtml(r.code)} ${escapeHtml(r.name)} (${escapeHtml(r.unit)})</span><span style="color:${st.color}">${st.label(r)}</span></div>
      <table>
        <tr><th>Opening</th><th>Receipts</th><th>Actual</th><th>Standard</th><th>Variance</th><th>Closing</th></tr>
        <tr><td>${r.opening.toFixed(2)}</td><td>${r.receipts.toFixed(2)}</td><td>${r.actual.toFixed(2)}</td><td>${r.standard.toFixed(2)}</td>
          <td style="color:${st.color}">${variance}</td><td>${r.closing.toFixed(2)}</td></tr>
      </table>
      ${r.departments.length > 0 ? `<table class="dt">
        <tr><th style="text-align:left">Department</th><th>Produced</th><th>Standard</th><th>Actual — Est.</th><th>% of item</th></tr>
        ${r.departments.map((d) => `<tr><td style="text-align:left">${escapeHtml(d.departmentName)}</td><td>${d.produced.toFixed(2)}</td>
          <td>${d.standard.toFixed(2)}</td><td>${d.actualEst.toFixed(2)}</td><td>${d.pctOfMaterial.toFixed(1)}%</td></tr>`).join("")}
      </table>` : ""}
      ${includeBomBreakdown && bom ? `<div class="b">${bom}</div>` : ""}
    </div>`;
  }).join("") || `<div style="color:#888">No consumption data found for this date</div>`;

  const hasDepartments = report.rows.some((r) => r.departments.length > 0);

  printWindow.document.write(`<!DOCTYPE html><html><head><title>Material Usage Report - Item-wise - ${dateLabel}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: Arial, sans-serif; color: #111; margin: 0; padding: 12px; }
      h2 { font-size: 17px; margin: 0; }
      h3 { font-size: 13px; margin: 14px 0 6px; }
      .meta { font-size: 12px; color: #555; margin: 3px 0 10px; }
      .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
      .box { border: 1px solid #d1d5db; border-left: 4px solid #d1d5db; border-radius: 5px; padding: 6px 8px; font-size: 11px; break-inside: avoid; page-break-inside: avoid; }
      .box .t { display: flex; justify-content: space-between; gap: 8px; font-weight: bold; font-size: 12px; }
      table { width: 100%; border-collapse: collapse; margin-top: 4px; }
      th, td { border: 1px solid #e5e7eb; padding: 2px 5px; text-align: right; font-size: 11px; }
      th { background: #f3f4f6; font-weight: 600; }
      .b { margin-top: 3px; color: #555; font-size: 10px; }
      .dt th, .dt td { font-size: 10px; color: #333; }
      .foot { margin-top: 10px; font-size: 10px; color: #888; }
    </style>
  </head><body>
    <h2>Material Usage Report — Item-wise, ${dateLabel}</h2>
    <div class="meta">${report.rows.length} material${report.rows.length === 1 ? "" : "s"} · ${escapeHtml(statusSummary(report))} · ${escapeHtml(tierLabel)} · each box in its own unit</div>
    <div class="grid">${boxes}</div>
    ${hasDepartments ? `<div class="foot">Department split: standard is exact (from BOM); Actual — Est. prorates the item's actual consumption by each department's share of its standard.</div>` : ""}
    <div class="foot">Printed on ${format(new Date(), "dd MMM yyyy, hh:mm a")}</div>
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

const STATUS_STYLE: Record<MaterialStatus, { border: string; text: string; pill: string }> = {
  over: { border: "border-l-destructive", text: "text-destructive", pill: "bg-destructive/10 text-destructive" },
  under: { border: "border-l-green-600", text: "text-green-600", pill: "bg-green-600/10 text-green-600" },
  on: { border: "border-l-muted-foreground", text: "", pill: "bg-muted text-foreground" },
  nostd: { border: "border-l-amber-500", text: "text-amber-600", pill: "bg-amber-500/10 text-amber-600" },
  idle: { border: "border-l-border", text: "text-muted-foreground", pill: "bg-muted text-muted-foreground" },
};

function MaterialCard({ r, index }: { r: MultiMaterialRow; index: number }) {
  const style = STATUS_STYLE[r.status];
  const max = Math.max(r.actual, r.standard, 0.0001);
  const hasVariance = r.status === "over" || r.status === "under" || r.status === "on";
  return (
    <Card className={cn("border-l-4", style.border)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate">
              {index + 1} · {r.name}
            </div>
            <div className="text-xs text-muted-foreground">{r.code} · unit: {r.unit}</div>
          </div>
          <div className="text-right shrink-0">
            {hasVariance ? (
              <>
                <div className={cn("text-xl font-bold", style.text)}>{signed(r.variancePct, 1)}%</div>
                <div className={cn("text-xs", style.text)}>
                  {r.status === "on" ? "on standard" : `${signed(r.variance)} ${r.unit} ${r.status}`}
                </div>
              </>
            ) : (
              <>
                <div className={cn("text-base font-bold", style.text)}>{r.status === "nostd" ? "No standard" : "No activity"}</div>
                <div className="text-xs text-muted-foreground">
                  {r.status === "nostd" ? "no BOM-linked production" : "nothing used or expected"}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {[
            ["Actual", r.actual.toFixed(2), ""],
            ["Standard", r.standard.toFixed(2), ""],
            ["Variance", hasVariance ? signed(r.variance) : "—", style.text],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-md bg-muted/50 px-2.5 py-1.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
              <div className={cn("font-semibold tabular-nums", color)}>
                {value} {value !== "—" && <span className="text-xs font-normal text-muted-foreground">{r.unit}</span>}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1">
          {([["Actual", r.actual, "bg-primary"], ["Standard", r.standard, "bg-muted-foreground/60"]] as const).map(([label, value, color]) => (
            <div key={label} className="grid grid-cols-[64px_1fr_72px] items-center gap-2 text-xs">
              <span className="text-muted-foreground">{label}</span>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full", color)} style={{ width: `${(value / max) * 100}%` }} />
              </div>
              <span className="text-right tabular-nums">{value.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 border-t border-dashed pt-2 text-xs text-muted-foreground">
          <span>Opening <b className="text-foreground font-medium">{r.opening.toFixed(2)}</b></span>
          <span>Receipts <b className="text-foreground font-medium">{r.receipts.toFixed(2)}</b></span>
          <span>Used <b className="text-foreground font-medium">{r.actual.toFixed(2)}</b></span>
          <span>Closing <b className="text-foreground font-medium">{r.closing.toFixed(2)}</b></span>
        </div>

        {r.departments.length > 0 && (
          <div className="rounded-md border">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left font-medium">Department</th>
                  <th className="px-2 py-1 text-right font-medium">Produced</th>
                  <th className="px-2 py-1 text-right font-medium">Standard</th>
                  <th className="px-2 py-1 text-right font-medium">Actual — Est.</th>
                  <th className="px-2 py-1 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {r.departments.map((d) => (
                  <tr key={d.departmentName} className="border-t">
                    <td className="px-2 py-1">{d.departmentName}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.produced.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.standard.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.actualEst.toFixed(2)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.pctOfMaterial.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(r.bomBreakdown.length > 0 || r.status === "nostd") && (
          <details className="text-xs">
            <summary className="cursor-pointer font-medium text-primary">
              {r.bomBreakdown.length > 0
                ? `Standard breakdown (${r.bomBreakdown.length} product${r.bomBreakdown.length === 1 ? "" : "s"})`
                : "Why no standard?"}
            </summary>
            <div className="mt-1.5 space-y-0.5 text-muted-foreground">
              {r.bomBreakdown.length > 0
                ? r.bomBreakdown.map((b) => (
                    <div key={b.productId}>
                      {b.productName} ({b.departmentName}): {b.produced} × {b.bomRate} = {b.subtotal.toFixed(2)}
                    </div>
                  ))
                : "Consumption was entered, but no production using this material (per BOM) was recorded for this date. Check Production Entry or the BOM."}
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

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
  const [layout, setLayout] = useState<"cards" | "table">("cards");
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

  const statusPills: [number, string, MaterialStatus][] = [
    [report.overCount, "over standard", "over"],
    [report.underCount, "under", "under"],
    [report.onCount, "on standard", "on"],
    [report.noStandardCount, "no standard", "nostd"],
  ];

  return (
    <>
      {/* Layout switch + status strip (no cross-material totals: units differ) */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded-md border p-0.5">
              {(["cards", "table"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLayout(l)}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-3 py-1.5 text-sm",
                    layout === l ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {l === "cards" ? <LayoutGrid className="h-4 w-4" /> : <TableIcon className="h-4 w-4" />}
                  {l === "cards" ? "Item-wise cards" : "Table"}
                </button>
              ))}
            </div>
            <span className="text-sm text-muted-foreground">{report.rows.length} material{report.rows.length === 1 ? "" : "s"} · {dateLabel}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {statusPills.filter(([n]) => n > 0).map(([n, label, st]) => (
              <span key={st} className={cn("rounded-full px-3 py-1 text-xs font-semibold", STATUS_STYLE[st].pill)}>
                {n} {label}
              </span>
            ))}
          </div>
          <div className="flex w-full flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={hideInactive} onCheckedChange={(v) => onHideInactiveChange(v === true)} />
              Hide materials with no activity
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox checked={includeBomInPrint} onCheckedChange={(v) => onIncludeBomInPrintChange(v === true)} />
              Include BOM breakdown in print / PDF
            </label>
          </div>
        </CardContent>
      </Card>

      {report.isLoading ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : report.rows.length === 0 ? (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No consumption data found for this date</CardContent></Card>
      ) : layout === "cards" ? (
        <div className="grid gap-4 md:grid-cols-2">
          {report.rows.map((r, i) => <MaterialCard key={r.id} r={r} index={i} />)}
        </div>
      ) : (
        <>
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
            <CardHeader>
              <CardTitle>Material Comparison — {dateLabel}</CardTitle>
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
                  {report.rows.map((r) => {
                    const isOpen = expanded.has(r.id);
                    const canExpand = r.bomBreakdown.length > 0;
                    const hasVariance = r.status === "over" || r.status === "under" || r.status === "on";
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
                            <span className={STATUS_STYLE[r.status].text}>{hasVariance ? signed(r.variance) : "—"}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            {hasVariance ? (
                              <span className={Math.abs(r.variancePct) > 10 ? "text-destructive font-semibold" : ""}>
                                {signed(r.variancePct, 1)}%
                              </span>
                            ) : (
                              <span className={cn("text-xs font-medium", STATUS_STYLE[r.status].text)}>
                                {r.status === "nostd" ? "No standard" : "—"}
                              </span>
                            )}
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
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      {/* Item-wise department breakdown (the cards already show it per material) */}
      {layout === "table" && !report.isLoading && report.rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Item-wise Department Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Produced (units)</TableHead>
                  <TableHead className="text-right">Standard</TableHead>
                  <TableHead className="text-right">Actual — Est.</TableHead>
                  <TableHead className="text-right">% of Item</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((r) => (
                  <Fragment key={r.id}>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableCell colSpan={5} className="py-1.5 font-semibold">
                        {r.code} — {r.name} <span className="font-normal text-muted-foreground">({r.unit})</span>
                      </TableCell>
                    </TableRow>
                    {r.departments.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-xs text-muted-foreground">
                          No department-linked production on this date
                        </TableCell>
                      </TableRow>
                    ) : (
                      r.departments.map((d) => (
                        <TableRow key={d.departmentName}>
                          <TableCell className="pl-6">{d.departmentName}</TableCell>
                          <TableCell className="text-right">{d.produced.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{d.standard.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{d.actualEst.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{d.pctOfMaterial.toFixed(1)}%</TableCell>
                        </TableRow>
                      ))
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground mt-2">
              Standard is exact (from BOM); Actual — Est. prorates each item's actual consumption by each department's share of that item's standard.
            </p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
