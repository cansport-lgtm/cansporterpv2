import { Fragment, useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, ChevronDown, ChevronRight, FileSpreadsheet, Layers, Printer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, PieChart, Pie, Cell } from "recharts";
import { format, startOfDay, startOfMonth, endOfMonth, eachDayOfInterval, eachMonthOfInterval, subMonths } from "date-fns";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { fetchAllRows } from "@/lib/accounting/fetchAllRows";
import { shareOrDownloadPdf } from "@/lib/sharePdf";
import { buildValueTierUsageReportPdf } from "@/lib/valueTierUsageReportPdf";
import { MATERIAL_VALUE_CATEGORIES, type MaterialValueCategory } from "@/lib/materialValueCategory";

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      <path d="M12.001 2C6.478 2 2 6.478 2 12c0 1.87.507 3.622 1.388 5.128L2 22l5.03-1.362A9.943 9.943 0 0 0 12.001 22C17.523 22 22 17.522 22 12S17.523 2 12.001 2zm0 18.062a8.02 8.02 0 0 1-4.088-1.117l-.293-.174-3.02.818.817-2.98-.19-.306A8.024 8.024 0 0 1 3.938 12c0-4.452 3.62-8.062 8.063-8.062 4.451 0 8.062 3.62 8.062 8.062 0 4.452-3.611 8.062-8.062 8.062z" />
    </svg>
  );
}

// HP / MP / CM plus a bucket for materials not yet tagged on the Items master.
type TierKey = MaterialValueCategory | "unclassified";
type ViewMode = "single" | "daily" | "monthly";

const TIERS: { key: TierKey; code: string; label: string; color: string }[] = [
  { key: "high_value", code: "HP", label: "HP · High Value", color: "#dc2626" },
  { key: "medium_value", code: "MP", label: "MP · Medium Value", color: "#2563eb" },
  { key: "customer_provided", code: "CM", label: "CM · Customer Provided", color: "#16a34a" },
  { key: "unclassified", code: "UC", label: "Unclassified", color: "#94a3b8" },
];

interface MaterialRow {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  cost_value: number | null;
  category: string | null;
  value_category: MaterialValueCategory | null;
}

interface ClosingRow {
  raw_material_id: string;
  closing_date: string;
  opening_quantity: number | null;
  receipt_quantity: number | null;
  closing_quantity: number | null;
  actual_consumption: number | null;
}

interface MaterialAgg {
  material: MaterialRow;
  tier: TierKey;
  rate: number;
  opening: number;
  receipts: number;
  usage: number;
  closing: number;
  standard: number;
  hasClosing: boolean;
}

interface TierAgg {
  key: TierKey;
  code: string;
  label: string;
  color: string;
  materials: number; // materials with actual usage in the period
  opening: number;
  receipts: number;
  usage: number;
  standard: number;
  closing: number;
  rows: MaterialAgg[];
}

const fmtMoney = (n: number) => "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtNum = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
const fmtQty = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtSigned = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + fmtNum(Math.abs(n));
const variancePct = (actual: number, standard: number) => (standard > 0 ? ((actual - standard) / standard) * 100 : null);
const fmtPct = (p: number | null) => (p === null ? "—" : (p > 0 ? "+" : "") + p.toFixed(1) + "%");
const varClass = (v: number) => (v > 0 ? "text-destructive" : v < 0 ? "text-green-600" : "");
const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export default function ValueTierUsageReportPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("daily");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [tierFilter, setTierFilter] = useState<TierKey | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [expandedTiers, setExpandedTiers] = useState<Set<TierKey>>(new Set(["high_value"]));
  const [sharing, setSharing] = useState(false);

  // Single Day = just the selected date; Daily = every day of the selected
  // month; Monthly = the 12 months up to it.
  const dateRange = useMemo(() => {
    if (viewMode === "single") {
      const day = startOfDay(selectedDate);
      const dayStr = format(day, "yyyy-MM-dd");
      return { start: day, end: day, startStr: dayStr, endStr: dayStr };
    }
    const end = endOfMonth(selectedDate);
    const start = viewMode === "daily" ? startOfMonth(selectedDate) : startOfMonth(subMonths(selectedDate, 11));
    return { start, end, startStr: format(start, "yyyy-MM-dd"), endStr: format(end, "yyyy-MM-dd") };
  }, [viewMode, selectedDate]);

  // Include inactive materials too: a material deactivated mid-period still has
  // closings in the period that belong in the report.
  const { data: materials } = useQuery({
    queryKey: ["value-tier-report-materials"],
    queryFn: () =>
      fetchAllRows<MaterialRow>((from, to) =>
        supabase
          .from("consumption_raw_materials")
          .select("id, code, name, unit, cost_value, category, value_category")
          .order("id")
          .range(from, to)
      ),
  });

  const { data: closings, isLoading: closingsLoading } = useQuery({
    queryKey: ["value-tier-report-closings", dateRange.startStr, dateRange.endStr],
    queryFn: () =>
      fetchAllRows<ClosingRow>((from, to) =>
        supabase
          .from("consumption_stock_closing")
          .select("raw_material_id, closing_date, opening_quantity, receipt_quantity, closing_quantity, actual_consumption")
          .gte("closing_date", dateRange.startStr)
          .lte("closing_date", dateRange.endStr)
          .order("closing_date")
          .order("id")
          .range(from, to)
      ),
  });

  const { data: bom } = useQuery({
    queryKey: ["value-tier-report-bom"],
    queryFn: () =>
      fetchAllRows<{ product_id: string; raw_material_id: string; standard_quantity: number }>((from, to) =>
        supabase
          .from("consumption_bom")
          .select("product_id, raw_material_id, standard_quantity")
          .eq("is_active", true)
          .order("id")
          .range(from, to)
      ),
  });

  const { data: production } = useQuery({
    queryKey: ["value-tier-report-production", dateRange.startStr, dateRange.endStr],
    queryFn: () =>
      fetchAllRows<{ product_id: string; quantity_produced: number; entry_date: string }>((from, to) =>
        supabase
          .from("consumption_production_entry")
          .select("product_id, quantity_produced, entry_date")
          .gte("entry_date", dateRange.startStr)
          .lte("entry_date", dateRange.endStr)
          .order("entry_date")
          .order("id")
          .range(from, to)
      ),
  });

  const categories = useMemo(
    () => Array.from(new Set((materials || []).map((m) => m.category).filter((c): c is string => !!c))).sort(),
    [materials]
  );

  // Materials in scope after the tier / category / search filters. Every
  // aggregate below reads from this set so the filters apply consistently.
  const scopedMaterials = useMemo(() => {
    const map = new Map<string, MaterialRow>();
    const q = search.trim().toLowerCase();
    (materials || []).forEach((m) => {
      const tier: TierKey = m.value_category ?? "unclassified";
      if (tierFilter !== "all" && tier !== tierFilter) return;
      if (categoryFilter !== "all" && m.category !== categoryFilter) return;
      if (q && !m.code.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) return;
      map.set(m.id, m);
    });
    return map;
  }, [materials, tierFilter, categoryFilter, search]);

  // BOM rate per (product, material). First active row wins, matching the
  // per-material Usage Report's bomData.find().
  const bomByProduct = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    (bom || []).forEach((b) => {
      let inner = map.get(b.product_id);
      if (!inner) map.set(b.product_id, (inner = new Map()));
      if (!inner.has(b.raw_material_id)) inner.set(b.raw_material_id, Number(b.standard_quantity) || 0);
    });
    return map;
  }, [bom]);

  const bucketKey = (dateStr: string) => (viewMode === "monthly" ? dateStr.slice(0, 7) : dateStr);

  const buckets = useMemo(() => {
    if (viewMode !== "monthly") {
      return eachDayOfInterval({ start: dateRange.start, end: dateRange.end }).map((d) => ({
        key: format(d, "yyyy-MM-dd"),
        label: format(d, "dd"),
        fullLabel: format(d, "dd MMM yyyy"),
      }));
    }
    return eachMonthOfInterval({ start: dateRange.start, end: dateRange.end }).map((d) => ({
      key: format(d, "yyyy-MM"),
      label: format(d, "MMM yy"),
      fullLabel: format(d, "MMMM yyyy"),
    }));
  }, [viewMode, dateRange]);

  const report = useMemo(() => {
    const byMaterial = new Map<string, MaterialAgg>();
    const trend = new Map<string, Record<TierKey, number>>();
    buckets.forEach((b) => trend.set(b.key, { high_value: 0, medium_value: 0, customer_provided: 0, unclassified: 0 }));

    const getAgg = (id: string): MaterialAgg | undefined => {
      const m = scopedMaterials.get(id);
      if (!m) return undefined;
      let agg = byMaterial.get(id);
      if (!agg) {
        agg = {
          material: m,
          tier: m.value_category ?? "unclassified",
          rate: Number(m.cost_value) || 0,
          opening: 0,
          receipts: 0,
          usage: 0,
          closing: 0,
          standard: 0,
          hasClosing: false,
        };
        byMaterial.set(id, agg);
      }
      return agg;
    };

    // Closings arrive date-ascending, so a material's first row carries the
    // period opening and its last row the period closing.
    (closings || []).forEach((c) => {
      const agg = getAgg(c.raw_material_id);
      if (!agg) return;
      if (!agg.hasClosing) agg.opening = Number(c.opening_quantity) || 0;
      agg.hasClosing = true;
      agg.receipts += Number(c.receipt_quantity) || 0;
      const used = Number(c.actual_consumption) || 0;
      agg.usage += used;
      agg.closing = Number(c.closing_quantity) || 0;
      const bucket = trend.get(bucketKey(c.closing_date));
      if (bucket) bucket[agg.tier] += used * agg.rate;
    });

    // Standard usage = BOM rate × quantity produced.
    (production || []).forEach((p) => {
      const lines = bomByProduct.get(p.product_id);
      if (!lines) return;
      lines.forEach((rate, rmId) => {
        const agg = getAgg(rmId);
        if (agg) agg.standard += rate * (Number(p.quantity_produced) || 0);
      });
    });

    const tiers: TierAgg[] = TIERS.filter((t) => tierFilter === "all" || t.key === tierFilter).map((t) => ({
      ...t,
      materials: 0,
      opening: 0,
      receipts: 0,
      usage: 0,
      standard: 0,
      closing: 0,
      rows: [],
    }));
    const tierMap = new Map(tiers.map((t) => [t.key, t]));

    byMaterial.forEach((agg) => {
      const t = tierMap.get(agg.tier);
      if (!t) return;
      t.opening += agg.opening * agg.rate;
      t.receipts += agg.receipts * agg.rate;
      t.usage += agg.usage * agg.rate;
      t.standard += agg.standard * agg.rate;
      t.closing += agg.closing * agg.rate;
      if (agg.usage > 0) t.materials += 1;
      if (agg.usage > 0 || agg.standard > 0) t.rows.push(agg);
    });
    tiers.forEach((t) => t.rows.sort((a, b) => b.usage * b.rate - a.usage * a.rate));

    const total = tiers.reduce(
      (s, t) => ({
        materials: s.materials + t.materials,
        opening: s.opening + t.opening,
        receipts: s.receipts + t.receipts,
        usage: s.usage + t.usage,
        standard: s.standard + t.standard,
        closing: s.closing + t.closing,
      }),
      { materials: 0, opening: 0, receipts: 0, usage: 0, standard: 0, closing: 0 }
    );

    const unratedUsed = Array.from(byMaterial.values()).filter((a) => a.usage > 0 && a.rate <= 0).length;

    const trendRows = buckets.map((b) => {
      const v = trend.get(b.key)!;
      return { label: b.label, fullLabel: b.fullLabel, ...v, total: v.high_value + v.medium_value + v.customer_provided + v.unclassified };
    });

    return { tiers, total, trendRows, unratedUsed };
    // bucketKey only depends on viewMode, which buckets already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closings, production, scopedMaterials, bomByProduct, buckets, tierFilter]);

  const { tiers, total, trendRows, unratedUsed } = report;
  const shareOf = (v: number) => (total.usage > 0 ? (v / total.usage) * 100 : 0);
  const visibleTrendRows = trendRows.filter((r) => r.total > 0);

  const chartConfig = Object.fromEntries(tiers.map((t) => [t.key, { label: t.code, color: t.color }]));
  const pieData = tiers.filter((t) => t.usage > 0).map((t) => ({ name: t.label, value: t.usage, color: t.color }));

  const toggleTier = (key: TierKey) =>
    setExpandedTiers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const periodLabel =
    viewMode === "monthly"
      ? `Last 12 Months up to ${format(selectedDate, "MMM yyyy")}`
      : viewMode === "single"
      ? format(selectedDate, "dd MMM yyyy")
      : format(selectedDate, "MMMM yyyy");
  const viewLabel = viewMode === "monthly" ? "Monthly" : viewMode === "single" ? "Single Day" : "Daily";
  const trendColumnLabel = viewMode === "monthly" ? "Month" : "Date";
  const filterLabel = [
    tierFilter === "all" ? "All value tiers" : TIERS.find((t) => t.key === tierFilter)?.label,
    categoryFilter === "all" ? "All categories" : `Category: ${categoryFilter}`,
    search.trim() ? `Search: "${search.trim()}"` : null,
  ]
    .filter(Boolean)
    .join(" | ");
  const hasData = total.usage > 0 || total.standard > 0 || total.opening > 0 || total.closing > 0;
  const fileStem = `Value-Tier-Usage-Report-${format(selectedDate, viewMode === "single" ? "yyyyMMdd" : "yyyyMM")}-${viewLabel.replace(/\s+/g, "-")}`;

  const handleExportExcel = () => {
    const wb = XLSX.utils.book_new();
    const summary = tiers.map((t) => ({
      "Value Tier": t.label,
      "Materials Used": t.materials,
      "Opening (₹)": Math.round(t.opening),
      "Receipts (₹)": Math.round(t.receipts),
      "Actual Usage (₹)": Math.round(t.usage),
      "Standard Usage (₹)": Math.round(t.standard),
      "Variance (₹)": Math.round(t.usage - t.standard),
      "Variance %": variancePct(t.usage, t.standard)?.toFixed(1) ?? "",
      "Closing (₹)": Math.round(t.closing),
      "% of Usage": shareOf(t.usage).toFixed(1),
    }));
    summary.push({
      "Value Tier": "Total",
      "Materials Used": total.materials,
      "Opening (₹)": Math.round(total.opening),
      "Receipts (₹)": Math.round(total.receipts),
      "Actual Usage (₹)": Math.round(total.usage),
      "Standard Usage (₹)": Math.round(total.standard),
      "Variance (₹)": Math.round(total.usage - total.standard),
      "Variance %": variancePct(total.usage, total.standard)?.toFixed(1) ?? "",
      "Closing (₹)": Math.round(total.closing),
      "% of Usage": "100.0",
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Tier Summary");

    const detail = tiers.flatMap((t) =>
      t.rows.map((r) => ({
        "Value Tier": t.code,
        Code: r.material.code,
        Material: r.material.name,
        Category: r.material.category || "",
        Unit: r.material.unit || "",
        "Rate (₹)": r.rate,
        "Usage Qty": Number(r.usage.toFixed(2)),
        "Standard Qty": Number(r.standard.toFixed(2)),
        "Usage Value (₹)": Math.round(r.usage * r.rate),
        "Standard Value (₹)": Math.round(r.standard * r.rate),
        "Variance Value (₹)": Math.round((r.usage - r.standard) * r.rate),
        "Variance %": variancePct(r.usage, r.standard)?.toFixed(1) ?? "",
      }))
    );
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), "Material Detail");

    const trendSheet = visibleTrendRows.map((r) => ({
      [trendColumnLabel]: r.fullLabel,
      ...Object.fromEntries(tiers.map((t) => [`${t.code} (₹)`, Math.round(r[t.key])])),
      "Total (₹)": Math.round(tiers.reduce((s, t) => s + r[t.key], 0)),
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(trendSheet), `${viewLabel} Trend`);

    XLSX.writeFile(wb, `${fileStem}.xlsx`);
  };

  const buildPdf = () =>
    buildValueTierUsageReportPdf({
      periodLabel,
      viewLabel,
      filterLabel,
      generatedOn: format(new Date(), "dd MMM yyyy, hh:mm a"),
      summary: tiers.map((t) => ({
        label: t.label,
        materials: t.materials,
        opening: t.opening,
        receipts: t.receipts,
        usage: t.usage,
        standard: t.standard,
        variance: t.usage - t.standard,
        variancePct: variancePct(t.usage, t.standard),
        closing: t.closing,
        share: shareOf(t.usage),
      })),
      total: {
        label: "Total",
        ...total,
        variance: total.usage - total.standard,
        variancePct: variancePct(total.usage, total.standard),
        share: total.usage > 0 ? 100 : 0,
      },
      details: tiers.map((t) => ({
        label: t.label,
        rows: t.rows.map((r) => ({
          code: r.material.code,
          name: r.material.name,
          unit: r.material.unit || "",
          rate: r.rate,
          usageQty: r.usage,
          standardQty: r.standard,
          usageValue: r.usage * r.rate,
          varianceValue: (r.usage - r.standard) * r.rate,
          variancePct: variancePct(r.usage, r.standard),
        })),
      })),
      tierLabels: tiers.map((t) => t.code),
      trendColumnLabel,
      trend: visibleTrendRows.map((r) => ({
        label: r.fullLabel,
        values: tiers.map((t) => r[t.key]),
        total: tiers.reduce((s, t) => s + r[t.key], 0),
      })),
    });

  const handleShareWhatsApp = async () => {
    try {
      setSharing(true);
      const blob = buildPdf();
      const summaryText =
        `*Value Tier Usage Report*\n${periodLabel}\n${filterLabel}\n\n` +
        tiers.map((t) => `${t.code}: ${fmtMoney(t.usage)} (${shareOf(t.usage).toFixed(1)}%)`).join("\n") +
        `\n\nTotal: ${fmtMoney(total.usage)}` +
        `\nVariance vs std: ${fmtSigned(total.usage - total.standard)} (${fmtPct(variancePct(total.usage, total.standard))})`;
      const result = await shareOrDownloadPdf({
        blob,
        fileName: `${fileStem}.pdf`,
        title: "Value Tier Usage Report",
        text: summaryText,
      });
      if (result === "downloaded") {
        toast.message("Report PDF downloaded", { description: "Attach the downloaded PDF to your WhatsApp chat." });
      }
    } catch (e) {
      toast.error((e as { message?: string })?.message || "Failed to share report");
    } finally {
      setSharing(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    const tierRow = (label: string, t: Omit<TierAgg, "key" | "code" | "label" | "color" | "rows">, bold = false) => {
      const v = t.usage - t.standard;
      return `<tr${bold ? ' class="total-row"' : ""}>
        <td>${escapeHtml(label)}</td><td>${t.materials}</td><td>${fmtNum(t.opening)}</td><td>${fmtNum(t.receipts)}</td>
        <td>${fmtNum(t.usage)}</td><td>${fmtNum(t.standard)}</td>
        <td style="color:${v > 0 ? "#dc2626" : v < 0 ? "#16a34a" : "inherit"}">${fmtSigned(v)}</td>
        <td>${fmtPct(variancePct(t.usage, t.standard))}</td><td>${fmtNum(t.closing)}</td>
        <td>${bold ? (total.usage > 0 ? "100.0%" : "0.0%") : shareOf(t.usage).toFixed(1) + "%"}</td></tr>`;
    };
    const detailRows = tiers
      .map(
        (t) =>
          `<tr class="tier-row"><td colspan="8">${escapeHtml(t.label)} (${t.rows.length})</td></tr>` +
          (t.rows.length === 0
            ? `<tr><td colspan="8" style="color:#888">No usage in this period</td></tr>`
            : t.rows
                .map((r) => {
                  const vv = (r.usage - r.standard) * r.rate;
                  return `<tr><td>${escapeHtml(r.material.code)} · ${escapeHtml(r.material.name)}</td><td>${escapeHtml(r.material.unit || "")}</td>
                  <td>${fmtQty(r.rate)}</td><td>${fmtQty(r.usage)}</td><td>${fmtQty(r.standard)}</td><td>${fmtNum(r.usage * r.rate)}</td>
                  <td style="color:${vv > 0 ? "#dc2626" : vv < 0 ? "#16a34a" : "inherit"}">${fmtSigned(vv)}</td>
                  <td>${fmtPct(variancePct(r.usage, r.standard))}</td></tr>`;
                })
                .join(""))
      )
      .join("");
    const trendTable = visibleTrendRows.length
      ? `<h2>${viewLabel} Usage Value by Tier (₹)</h2><table><thead><tr><th>${trendColumnLabel}</th>${tiers
          .map((t) => `<th>${t.code}</th>`)
          .join("")}<th>Total</th></tr></thead><tbody>${visibleTrendRows
          .map(
            (r) =>
              `<tr><td>${r.fullLabel}</td>${tiers.map((t) => `<td>${fmtNum(r[t.key])}</td>`).join("")}<td>${fmtNum(
                tiers.reduce((s, t) => s + r[t.key], 0)
              )}</td></tr>`
          )
          .join("")}</tbody></table>`
      : "";

    printWindow.document.write(`<!DOCTYPE html><html><head><title>Value Tier Usage Report</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; } h2 { font-size: 14px; margin: 24px 0 8px; }
        .meta { font-size: 13px; color: #555; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 5px 8px; text-align: right; }
        th:first-child, td:first-child { text-align: left; }
        th { background: #f3f4f6; font-weight: 600; }
        .total-row { font-weight: bold; border-top: 2px solid #333; }
        .tier-row td { background: #f3f4f6; font-weight: bold; text-align: left; }
        @media print { body { padding: 0; } tr { break-inside: avoid; } }
      </style></head><body>
      <h1>Value Tier Usage Report</h1>
      <div class="meta">${viewLabel} | ${periodLabel} | ${escapeHtml(filterLabel)}<br/>Amounts in ₹ = quantity × current material rate</div>
      <h2>Tier Summary (₹)</h2>
      <table><thead><tr><th>Value Tier</th><th>Materials Used</th><th>Opening</th><th>Receipts</th><th>Actual Usage</th><th>Standard Usage</th><th>Variance</th><th>Var %</th><th>Closing</th><th>% of Usage</th></tr></thead>
      <tbody>${tiers.map((t) => tierRow(t.label, t)).join("")}${tierRow("Total", total, true)}</tbody></table>
      ${trendTable}
      <h2>Material-wise Detail by Tier</h2>
      <table><thead><tr><th>Material</th><th>Unit</th><th>Rate (₹)</th><th>Usage Qty</th><th>Std Qty</th><th>Usage Value (₹)</th><th>Variance (₹)</th><th>Var %</th></tr></thead>
      <tbody>${detailRows}</tbody></table>
      <div style="margin-top:12px;font-size:11px;color:#888;">Printed on ${format(new Date(), "dd MMM yyyy, hh:mm a")}</div>
      <script>window.onload=function(){window.print();}</script>
      </body></html>`);
    printWindow.document.close();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Value Tier Usage Report</h1>
            <p className="page-description">Consumption value by HP / MP / CM tier, across all raw materials</p>
          </div>
          {hasData && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="border-green-600 text-green-600 hover:bg-green-50 hover:text-green-700"
                onClick={handleShareWhatsApp}
                disabled={sharing}
              >
                <WhatsAppIcon className="mr-2 h-4 w-4" />
                {sharing ? "Preparing…" : "Share PDF via WhatsApp"}
              </Button>
              <Button variant="outline" onClick={handleExportExcel}>
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Export Excel
              </Button>
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="mr-2 h-4 w-4" />
                Print Report
              </Button>
            </div>
          )}
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="text-sm font-medium mb-1.5 block">View</label>
                <Select value={viewMode} onValueChange={(v: ViewMode) => setViewMode(v)}>
                  <SelectTrigger className="w-[190px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single Day</SelectItem>
                    <SelectItem value="daily">Daily (one month)</SelectItem>
                    <SelectItem value="monthly">Monthly (12 months)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">{viewMode === "daily" ? "Month" : viewMode === "single" ? "Date" : "Up to"}</label>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[180px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(selectedDate, viewMode === "daily" ? "MMMM yyyy" : viewMode === "single" ? "dd MMM yyyy" : "MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        if (date) {
                          setSelectedDate(date);
                          setIsCalendarOpen(false);
                        }
                      }}
                      disabled={(date) => date > new Date()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Value Tier</label>
                <Select value={tierFilter} onValueChange={(v: TierKey | "all") => setTierFilter(v)}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All value tiers</SelectItem>
                    {MATERIAL_VALUE_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                    <SelectItem value="unclassified">Unclassified</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Category</label>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-sm font-medium mb-1.5 block">Search material</label>
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Code or name…" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPI cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="border-l-4 border-l-primary">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Usage Value</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{fmtMoney(total.usage)}</div>
              <p className="text-xs text-muted-foreground">
                {total.materials} materials used ·{" "}
                <span className={varClass(total.usage - total.standard)}>
                  {fmtPct(variancePct(total.usage, total.standard))} vs std
                </span>
              </p>
            </CardContent>
          </Card>
          {tiers.map((t) => (
            <Card key={t.key} className="border-l-4" style={{ borderLeftColor: t.color }}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{t.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtMoney(t.usage)}</div>
                <p className="text-xs text-muted-foreground">
                  {shareOf(t.usage).toFixed(1)}% · {t.materials} materials ·{" "}
                  <span className={varClass(t.usage - t.standard)}>{fmtPct(variancePct(t.usage, t.standard))} vs std</span>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        {closingsLoading ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">Loading consumption data…</CardContent>
          </Card>
        ) : !hasData ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Layers className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">No consumption found for this period</p>
              <p className="text-sm mt-1">Try another month or clear the filters above</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>{viewMode === "single" ? `Usage Value by Tier — ${periodLabel}` : `${viewLabel} Usage Value by Tier`}</CardTitle>
                </CardHeader>
                <CardContent>
                  {viewMode === "single" ? (
                    // One day has a single stacked bar, so show one bar per tier instead.
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <BarChart data={tiers.map((t) => ({ name: t.code, value: t.usage, color: t.color }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" fontSize={12} />
                        <YAxis fontSize={12} tickFormatter={(v) => fmtNum(v)} width={80} />
                        <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                        <Bar dataKey="value" name="Usage value" radius={[4, 4, 0, 0]}>
                          {tiers.map((t) => (
                            <Cell key={t.key} fill={t.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <ChartContainer config={chartConfig} className="h-[300px] w-full">
                      <BarChart data={trendRows}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" fontSize={12} />
                        <YAxis fontSize={12} tickFormatter={(v) => fmtNum(v)} width={80} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Legend />
                        {tiers.map((t, i) => (
                          <Bar
                            key={t.key}
                            dataKey={t.key}
                            name={t.code}
                            stackId="tier"
                            fill={t.color}
                            radius={i === tiers.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                          />
                        ))}
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Share of Usage Value</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[300px] w-full">
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
                        {pieData.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Pie>
                      <Legend />
                    </PieChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            {/* Tier summary */}
            <Card>
              <CardHeader>
                <CardTitle>Tier Summary (₹)</CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Value Tier</TableHead>
                      <TableHead className="text-right">Materials Used</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                      <TableHead className="text-right">Actual Usage</TableHead>
                      <TableHead className="text-right">Standard Usage</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Var %</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                      <TableHead className="text-right">% of Usage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tiers.map((t) => (
                      <TableRow key={t.key}>
                        <TableCell className="font-medium whitespace-nowrap">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm mr-2" style={{ background: t.color }} />
                          {t.label}
                        </TableCell>
                        <TableCell className="text-right">{t.materials}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.opening)}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.receipts)}</TableCell>
                        <TableCell className="text-right font-semibold">{fmtNum(t.usage)}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.standard)}</TableCell>
                        <TableCell className={cn("text-right", varClass(t.usage - t.standard))}>{fmtSigned(t.usage - t.standard)}</TableCell>
                        <TableCell className={cn("text-right", varClass(t.usage - t.standard))}>{fmtPct(variancePct(t.usage, t.standard))}</TableCell>
                        <TableCell className="text-right">{fmtNum(t.closing)}</TableCell>
                        <TableCell className="text-right">{shareOf(t.usage).toFixed(1)}%</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="font-bold border-t-2">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">{total.materials}</TableCell>
                      <TableCell className="text-right">{fmtNum(total.opening)}</TableCell>
                      <TableCell className="text-right">{fmtNum(total.receipts)}</TableCell>
                      <TableCell className="text-right">{fmtNum(total.usage)}</TableCell>
                      <TableCell className="text-right">{fmtNum(total.standard)}</TableCell>
                      <TableCell className={cn("text-right", varClass(total.usage - total.standard))}>{fmtSigned(total.usage - total.standard)}</TableCell>
                      <TableCell className={cn("text-right", varClass(total.usage - total.standard))}>{fmtPct(variancePct(total.usage, total.standard))}</TableCell>
                      <TableCell className="text-right">{fmtNum(total.closing)}</TableCell>
                      <TableCell className="text-right">{total.usage > 0 ? "100.0%" : "0.0%"}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
                {unratedUsed > 0 && (
                  <p className="text-xs text-amber-600 mt-2">
                    {unratedUsed} material(s) with usage have no rate set, so they count as ₹0. Set their unit price on the Items master.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Material detail grouped by tier */}
            <Card>
              <CardHeader>
                <CardTitle>
                  Material-wise Detail by Tier{" "}
                  <span className="text-xs font-normal text-muted-foreground">(click a tier to expand or collapse)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Material</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right">Rate (₹)</TableHead>
                      <TableHead className="text-right">Usage Qty</TableHead>
                      <TableHead className="text-right">Std Qty</TableHead>
                      <TableHead className="text-right">Usage Value (₹)</TableHead>
                      <TableHead className="text-right">Variance (₹)</TableHead>
                      <TableHead className="text-right">Var %</TableHead>
                      <TableHead className="text-right">% of Tier</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tiers.map((t) => {
                      const open = expandedTiers.has(t.key);
                      return (
                        <Fragment key={t.key}>
                          <TableRow
                            className="cursor-pointer font-semibold hover:bg-muted/60"
                            style={{ background: `${t.color}14` }}
                            onClick={() => toggleTier(t.key)}
                          >
                            <TableCell colSpan={5}>
                              {open ? <ChevronDown className="inline h-4 w-4 mr-1" /> : <ChevronRight className="inline h-4 w-4 mr-1" />}
                              {t.label} ({t.rows.length})
                            </TableCell>
                            <TableCell className="text-right">{fmtNum(t.usage)}</TableCell>
                            <TableCell className={cn("text-right", varClass(t.usage - t.standard))}>{fmtSigned(t.usage - t.standard)}</TableCell>
                            <TableCell className={cn("text-right", varClass(t.usage - t.standard))}>{fmtPct(variancePct(t.usage, t.standard))}</TableCell>
                            <TableCell className="text-right">{t.usage > 0 ? "100%" : "—"}</TableCell>
                          </TableRow>
                          {open &&
                            (t.rows.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={9} className="text-center text-muted-foreground">
                                  No usage in this period
                                </TableCell>
                              </TableRow>
                            ) : (
                              t.rows.map((r) => {
                                const value = r.usage * r.rate;
                                const vv = (r.usage - r.standard) * r.rate;
                                return (
                                  <TableRow key={r.material.id}>
                                    <TableCell className="whitespace-nowrap">
                                      <span className="text-muted-foreground">{r.material.code}</span> · {r.material.name}
                                    </TableCell>
                                    <TableCell>{r.material.unit}</TableCell>
                                    <TableCell className="text-right">{fmtQty(r.rate)}</TableCell>
                                    <TableCell className="text-right">{fmtQty(r.usage)}</TableCell>
                                    <TableCell className="text-right">{fmtQty(r.standard)}</TableCell>
                                    <TableCell className="text-right">{fmtNum(value)}</TableCell>
                                    <TableCell className={cn("text-right", varClass(vv))}>{fmtSigned(vv)}</TableCell>
                                    <TableCell className={cn("text-right", varClass(vv))}>{fmtPct(variancePct(r.usage, r.standard))}</TableCell>
                                    <TableCell className="text-right">{t.usage > 0 ? ((value / t.usage) * 100).toFixed(1) + "%" : "—"}</TableCell>
                                  </TableRow>
                                );
                              })
                            ))}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                <p className="text-xs text-muted-foreground mt-2">
                  Value = quantity × current material rate (Items master). Standard usage = BOM quantity × production entries.
                  Only materials with actual or standard usage in the period are listed.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ERPLayout>
  );
}
