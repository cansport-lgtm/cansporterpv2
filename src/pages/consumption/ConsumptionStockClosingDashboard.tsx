import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  endOfMonth,
  endOfWeek,
  format,
  isLastDayOfMonth,
  min,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Calendar as CalendarIcon,
  Boxes,
  Package,
  Layers,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  ChevronDown,
  Beaker,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface ClosingRow {
  id: string;
  closing_date: string;
  opening_quantity: number | null;
  receipt_quantity: number | null;
  closing_quantity: number;
  actual_consumption: number | null;
  raw_material_id: string;
  consumption_raw_materials: {
    id: string;
    code: string;
    name: string;
    unit: string | null;
    category: string | null;
    cost_value: number | null;
    threshold: number | null;
  } | null;
}

type PeriodMode = "daily" | "weekly" | "monthly";

// A material's figures aggregated over the selected period: opening from the
// first closing entry in the range, receipts/consumption summed across it,
// closing from the last entry.
interface MaterialAgg {
  raw_material_id: string;
  opening: number;
  receipt: number;
  consumed: number;
  closing: number;
  material: ClosingRow["consumption_raw_materials"];
}

// Supabase caps a select at 1000 rows; a month of daily closings across all
// materials can exceed that, so page through the range.
async function fetchClosingRows(select: string, from: string, to: string) {
  const pageSize = 1000;
  const all: any[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("consumption_stock_closing")
      .select(select)
      .gte("closing_date", from)
      .lte("closing_date", to)
      .order("closing_date")
      .order("id")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return all;
}

export default function ConsumptionStockClosingDashboard() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [period, setPeriod] = useState<PeriodMode>("daily");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());
  const [trendMode, setTrendMode] = useState<"total" | "category">("total");

  const toggleCat = (name: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Period window derived from the selected date (weeks run Mon–Sun; open
  // periods are clipped at today).
  const { rangeStartStr, rangeEndStr, trendStartStr, periodLabel } = useMemo(() => {
    const today = new Date();
    let start: Date;
    let end: Date;
    let trendStart: Date;
    let label: string;
    if (period === "weekly") {
      start = startOfWeek(selectedDate, { weekStartsOn: 1 });
      end = min([endOfWeek(selectedDate, { weekStartsOn: 1 }), today]);
      trendStart = startOfWeek(subWeeks(start, 11), { weekStartsOn: 1 });
      label = `${format(start, "dd MMM")} – ${format(end, "dd MMM yyyy")}`;
    } else if (period === "monthly") {
      start = startOfMonth(selectedDate);
      end = min([endOfMonth(selectedDate), today]);
      trendStart = startOfMonth(subMonths(start, 11));
      label = format(start, "MMMM yyyy");
    } else {
      start = selectedDate;
      end = selectedDate;
      trendStart = subDays(selectedDate, 13);
      label = format(selectedDate, "dd MMM yyyy");
    }
    return {
      rangeStartStr: format(start, "yyyy-MM-dd"),
      rangeEndStr: format(end, "yyyy-MM-dd"),
      trendStartStr: format(trendStart, "yyyy-MM-dd"),
      periodLabel: label,
    };
  }, [period, selectedDate]);

  // Closing rows for the selected period
  const { data: closingRows, isLoading } = useQuery({
    queryKey: ["consumption-closing-dashboard", rangeStartStr, rangeEndStr],
    queryFn: async () =>
      (await fetchClosingRows(
        `id, closing_date, opening_quantity, receipt_quantity, closing_quantity, actual_consumption, raw_material_id,
         consumption_raw_materials(id, code, name, unit, category, cost_value, threshold)`,
        rangeStartStr,
        rangeEndStr,
      )) as unknown as ClosingRow[],
  });

  // Collapse the period's rows to one aggregate per material (rows arrive
  // date-ascending, so the last write per material is the period's closing).
  const closingData = useMemo(() => {
    if (!closingRows) return undefined;
    const map = new Map<string, MaterialAgg>();
    closingRows.forEach((row) => {
      const existing = map.get(row.raw_material_id);
      if (!existing) {
        map.set(row.raw_material_id, {
          raw_material_id: row.raw_material_id,
          opening: Number(row.opening_quantity) || 0,
          receipt: Number(row.receipt_quantity) || 0,
          consumed: Number(row.actual_consumption) || 0,
          closing: Number(row.closing_quantity) || 0,
          material: row.consumption_raw_materials,
        });
      } else {
        existing.receipt += Number(row.receipt_quantity) || 0;
        existing.consumed += Number(row.actual_consumption) || 0;
        existing.closing = Number(row.closing_quantity) || 0;
      }
    });
    return Array.from(map.values());
  }, [closingRows]);

  // Weekly materials are due on Mondays and on the last day of each month.
  // Check the current week's Monday and the most recent month-end for
  // materials with no entry posted yet.
  const today = new Date();
  const thisMondayStr = format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd");
  const lastMonthEndStr = format(
    isLastDayOfMonth(today) ? today : endOfMonth(subMonths(today, 1)),
    "yyyy-MM-dd",
  );
  const weeklyDueDates = Array.from(new Set([thisMondayStr, lastMonthEndStr]));
  const { data: missedWeekly = [] } = useQuery({
    queryKey: ["consumption-missed-weekly", ...weeklyDueDates],
    queryFn: async () => {
      const [materialsRes, closingsRes] = await Promise.all([
        supabase
          .from("consumption_raw_materials")
          .select("id, code, name")
          .eq("is_active", true)
          .eq("closing_frequency", "weekly"),
        supabase
          .from("consumption_stock_closing")
          .select("raw_material_id, closing_date")
          .in("closing_date", weeklyDueDates),
      ]);
      if (materialsRes.error) throw materialsRes.error;
      if (closingsRes.error) throw closingsRes.error;
      return weeklyDueDates
        .map((due) => {
          const posted = new Set(
            (closingsRes.data || [])
              .filter((c) => c.closing_date === due)
              .map((c) => c.raw_material_id),
          );
          return {
            date: due,
            kind: due === thisMondayStr ? "Monday" : "month-end",
            missing: (materialsRes.data || []).filter((m) => !posted.has(m.id)),
          };
        })
        .filter((d) => d.missing.length > 0);
    },
  });

  // Trend data: 14 days in daily view, 12 weeks in weekly, 12 months in monthly
  const { data: trendData } = useQuery({
    queryKey: ["consumption-closing-trend", period, trendStartStr, rangeEndStr],
    queryFn: async () =>
      fetchClosingRows(
        `closing_date, closing_quantity, actual_consumption, raw_material_id,
         consumption_raw_materials(category)`,
        trendStartStr,
        rangeEndStr,
      ),
  });

  // KPIs
  const kpis = useMemo(() => {
    if (!closingData)
      return { items: 0, units: 0, categories: 0, value: 0, zeroStock: 0, lowStock: 0, consumed: 0 };
    const catSet = new Set<string>();
    let units = 0;
    let value = 0;
    let consumed = 0;
    let zeroStock = 0;
    let lowStock = 0;
    closingData.forEach((agg) => {
      const qty = agg.closing;
      const cv = Number(agg.material?.cost_value) || 0;
      const threshold = Number(agg.material?.threshold) || 0;
      units += qty;
      value += qty * cv;
      consumed += agg.consumed;
      if (qty === 0) zeroStock += 1;
      else if (threshold > 0 && qty <= threshold) lowStock += 1;
      catSet.add(agg.material?.category || "Uncategorized");
    });
    return {
      items: closingData.length,
      units,
      categories: catSet.size,
      value,
      zeroStock,
      lowStock,
      consumed,
    };
  }, [closingData]);

  // Category breakdown (with item rows)
  const categoryBreakdown = useMemo(() => {
    if (!closingData)
      return [] as Array<{
        name: string;
        qty: number;
        value: number;
        items: number;
        consumed: number;
        rows: Array<{
          code: string;
          name: string;
          unit: string;
          opening: number;
          receipt: number;
          consumed: number;
          qty: number;
          value: number;
          isLow: boolean;
          isZero: boolean;
        }>;
      }>;
    const map: Record<
      string,
      {
        name: string;
        qty: number;
        value: number;
        items: number;
        consumed: number;
        rows: Array<{
          code: string;
          name: string;
          unit: string;
          opening: number;
          receipt: number;
          consumed: number;
          qty: number;
          value: number;
          isLow: boolean;
          isZero: boolean;
        }>;
      }
    > = {};
    closingData.forEach((agg) => {
      const catName = agg.material?.category || "Uncategorized";
      const qty = agg.closing;
      const cv = Number(agg.material?.cost_value) || 0;
      const threshold = Number(agg.material?.threshold) || 0;
      if (!map[catName])
        map[catName] = { name: catName, qty: 0, value: 0, items: 0, consumed: 0, rows: [] };
      map[catName].qty += qty;
      map[catName].value += qty * cv;
      map[catName].consumed += agg.consumed;
      map[catName].items += 1;
      map[catName].rows.push({
        code: agg.material?.code || "—",
        name: agg.material?.name || "—",
        unit: agg.material?.unit || "",
        opening: agg.opening,
        receipt: agg.receipt,
        consumed: agg.consumed,
        qty,
        value: qty * cv,
        isLow: threshold > 0 && qty > 0 && qty <= threshold,
        isZero: qty === 0,
      });
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [closingData]);

  // Top 10 items by value (or by qty for non-admin)
  const topItems = useMemo(() => {
    if (!closingData) return [];
    return [...closingData]
      .map((agg) => {
        const qty = agg.closing;
        const cv = Number(agg.material?.cost_value) || 0;
        return {
          code: agg.material?.code || "—",
          name: agg.material?.name || "—",
          unit: agg.material?.unit || "",
          category: agg.material?.category || "Uncategorized",
          qty,
          value: qty * cv,
        };
      })
      .sort((a, b) => (isSuperAdmin ? b.value - a.value : b.qty - a.qty))
      .slice(0, 10);
  }, [closingData, isSuperAdmin]);

  // Low / zero-stock alerts
  const lowStockItems = useMemo(() => {
    if (!closingData) return [];
    return closingData
      .map((agg) => {
        const qty = agg.closing;
        const threshold = Number(agg.material?.threshold) || 0;
        return {
          code: agg.material?.code || "—",
          name: agg.material?.name || "—",
          unit: agg.material?.unit || "",
          category: agg.material?.category || "Uncategorized",
          qty,
          threshold,
          isZero: qty === 0,
        };
      })
      .filter((r) => r.isZero || (r.threshold > 0 && r.qty <= r.threshold))
      .sort((a, b) => Number(b.isZero) - Number(a.isZero) || a.qty - b.qty)
      .slice(0, 10);
  }, [closingData]);

  // Trend, bucketed by day/week/month. Consumption sums across a bucket;
  // closing stock takes each material's last entry in the bucket, then sums.
  const { trendChart, trendByCat, catNames } = useMemo(() => {
    if (!trendData)
      return {
        trendChart: [] as Array<{ label: string; qty: number; consumed: number }>,
        trendByCat: [] as Array<Record<string, any>>,
        catNames: [] as string[],
      };
    const keyOf = (dateStr: string) => {
      if (period === "daily") return dateStr;
      const d = new Date(dateStr + "T00:00:00");
      const start = period === "weekly" ? startOfWeek(d, { weekStartsOn: 1 }) : startOfMonth(d);
      return format(start, "yyyy-MM-dd");
    };
    const buckets = new Map<
      string,
      { consumed: number; latest: Map<string, { date: string; qty: number; cat: string }> }
    >();
    trendData.forEach((row: any) => {
      const key = keyOf(row.closing_date);
      let b = buckets.get(key);
      if (!b) {
        b = { consumed: 0, latest: new Map() };
        buckets.set(key, b);
      }
      b.consumed += Number(row.actual_consumption) || 0;
      const prev = b.latest.get(row.raw_material_id);
      if (!prev || row.closing_date >= prev.date) {
        b.latest.set(row.raw_material_id, {
          date: row.closing_date,
          qty: Number(row.closing_quantity) || 0,
          cat: row.consumption_raw_materials?.category || "Uncategorized",
        });
      }
    });
    const labelOf = (key: string) => {
      const d = new Date(key + "T00:00:00");
      return period === "monthly" ? format(d, "MMM yy") : format(d, "dd MMM");
    };
    const sortedKeys = Array.from(buckets.keys()).sort();
    const catSet = new Set<string>();
    buckets.forEach((b) => b.latest.forEach((v) => catSet.add(v.cat)));
    const names = Array.from(catSet).sort();
    const total = sortedKeys.map((key) => {
      const b = buckets.get(key)!;
      let qty = 0;
      b.latest.forEach((v) => (qty += v.qty));
      return { label: labelOf(key), qty, consumed: b.consumed };
    });
    const byCat = sortedKeys.map((key) => {
      const b = buckets.get(key)!;
      const entry: Record<string, any> = { label: labelOf(key) };
      names.forEach((n) => (entry[n] = 0));
      b.latest.forEach((v) => {
        entry[v.cat] = (entry[v.cat] || 0) + v.qty;
      });
      return entry;
    });
    return { trendChart: total, trendByCat: byCat, catNames: names };
  }, [trendData, period]);

  const palette = [
    "hsl(var(--primary))",
    "hsl(262 83% 58%)",
    "hsl(142 71% 45%)",
    "hsl(38 92% 50%)",
    "hsl(0 84% 60%)",
    "hsl(199 89% 48%)",
    "hsl(280 65% 60%)",
    "hsl(173 80% 40%)",
    "hsl(24 95% 53%)",
    "hsl(220 70% 50%)",
  ];

  const fmtNum = (n: number) =>
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
  const fmtCurrency = (n: number) =>
    "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Stock Closing Dashboard"
          description={
            period === "daily"
              ? "End-of-day raw material stock snapshot across categories"
              : period === "weekly"
                ? "Weekly raw material stock summary across categories"
                : "Monthly raw material stock summary across categories"
          }
          icon={Beaker}
          iconColor="bg-red-500/15 text-red-500"
        >
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
              {(["daily", "weekly", "monthly"] as PeriodMode[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-sm capitalize transition-colors",
                    period === p
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="min-w-[200px] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {periodLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <CalendarComponent
                  mode="single"
                  selected={selectedDate}
                  onSelect={(d) => {
                    if (d) {
                      setSelectedDate(d);
                      setIsCalendarOpen(false);
                    }
                  }}
                  disabled={(d) => d > new Date()}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
        </PageHeader>

        {missedWeekly.length > 0 && (
          <Card className="border-amber-500/50 bg-amber-500/5">
            <CardContent className="space-y-1.5 p-3 text-sm">
              {missedWeekly.map((due) => (
                <div key={due.date} className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                  <span>
                    Weekly stock closing for {due.kind} {format(new Date(due.date + "T00:00:00"), "dd MMM")} not
                    posted yet for {due.missing.length} material{due.missing.length > 1 ? "s" : ""}:{" "}
                    {due.missing.slice(0, 6).map((m) => m.name).join(", ")}
                    {due.missing.length > 6 ? ` and ${due.missing.length - 6} more` : ""}.
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard icon={Boxes} label="Items Closed" value={fmtNum(kpis.items)} tone="violet" />
          <KpiCard icon={Package} label="Total Units" value={fmtNum(kpis.units)} tone="blue" />
          <KpiCard icon={Layers} label="Categories" value={fmtNum(kpis.categories)} tone="emerald" />
          <KpiCard
            icon={TrendingDown}
            label={period === "daily" ? "Consumed Today" : period === "weekly" ? "Consumed (Week)" : "Consumed (Month)"}
            value={fmtNum(kpis.consumed)}
            tone="rose"
          />
          <KpiCard icon={AlertCircle} label="Low / Zero Stock" value={fmtNum(kpis.zeroStock + kpis.lowStock)} tone="amber" />
          {isSuperAdmin && (
            <KpiCard icon={TrendingUp} label="Stock Value" value={fmtCurrency(kpis.value)} tone="primary" />
          )}
        </div>

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Closing Quantity by Category</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px] pt-2">
              {categoryBreakdown.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="name"
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={11}
                      angle={-15}
                      textAnchor="end"
                      height={60}
                    />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar dataKey="qty" name="Closing Qty" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">
                {period === "daily"
                  ? "14-Day Closing Trend"
                  : period === "weekly"
                    ? "12-Week Closing Trend"
                    : "12-Month Closing Trend"}
              </CardTitle>
              <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setTrendMode("total")}
                  className={cn(
                    "px-2.5 py-1 rounded-sm transition-colors",
                    trendMode === "total"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Total
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMode("category")}
                  className={cn(
                    "px-2.5 py-1 rounded-sm transition-colors",
                    trendMode === "category"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  By Category
                </button>
              </div>
            </CardHeader>
            <CardContent className="h-[280px] pt-2">
              {trendMode === "total" ? (
                trendChart.length === 0 ? (
                  <EmptyState />
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChart}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />
                      <Line
                        type="monotone"
                        dataKey="qty"
                        name="Closing Stock"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="consumed"
                        name="Consumed"
                        stroke="hsl(0 84% 60%)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )
              ) : trendByCat.length === 0 || catNames.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendByCat}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                    <Tooltip
                      contentStyle={{
                        background: "hsl(var(--popover))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} iconType="line" />
                    {catNames.map((name, idx) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        name={name}
                        stroke={palette[idx % palette.length]}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Category summary table (expandable) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Category Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Closing Qty</TableHead>
                    <TableHead className="text-right">Consumed</TableHead>
                    {isSuperAdmin && <TableHead className="text-right">Stock Value</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 6 : 5} className="text-center text-muted-foreground py-6">
                        Loading…
                      </TableCell>
                    </TableRow>
                  ) : categoryBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 6 : 5} className="text-center text-muted-foreground py-6">
                        No closing entries for this {period === "daily" ? "date" : period === "weekly" ? "week" : "month"}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    categoryBreakdown.map((c) => {
                      const isOpen = expandedCats.has(c.name);
                      const sortedRows = [...c.rows].sort((a, b) =>
                        isSuperAdmin ? b.value - a.value : b.qty - a.qty,
                      );
                      return (
                        <Fragment key={c.name}>
                          <TableRow className="cursor-pointer" onClick={() => toggleCat(c.name)}>
                            <TableCell className="w-10 p-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleCat(c.name);
                                }}
                                className="p-1 hover:bg-muted rounded"
                                aria-label={isOpen ? "Collapse" : "Expand"}
                              >
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell className="font-medium">{c.name}</TableCell>
                            <TableCell className="text-right">{fmtNum(c.items)}</TableCell>
                            <TableCell className="text-right">{fmtNum(c.qty)}</TableCell>
                            <TableCell className="text-right text-rose-600 dark:text-rose-400">
                              {fmtNum(c.consumed)}
                            </TableCell>
                            {isSuperAdmin && (
                              <TableCell className="text-right font-semibold">{fmtCurrency(c.value)}</TableCell>
                            )}
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={isSuperAdmin ? 6 : 5} className="p-0">
                                <div className="overflow-x-auto p-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs uppercase">Code</TableHead>
                                        <TableHead className="text-xs uppercase">Item</TableHead>
                                        <TableHead className="text-xs uppercase">Unit</TableHead>
                                        <TableHead className="text-xs uppercase text-right">Opening</TableHead>
                                        <TableHead className="text-xs uppercase text-right">Receipt</TableHead>
                                        <TableHead className="text-xs uppercase text-right">Consumed</TableHead>
                                        <TableHead className="text-xs uppercase text-right">Closing</TableHead>
                                        {isSuperAdmin && (
                                          <TableHead className="text-xs uppercase text-right">Stock Value</TableHead>
                                        )}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {sortedRows.map((r, idx) => (
                                        <TableRow key={`${c.name}-${r.code}-${idx}`}>
                                          <TableCell className="font-mono text-xs">{r.code}</TableCell>
                                          <TableCell className="font-medium">
                                            {r.name}
                                            {r.isZero && (
                                              <span className="ml-2 text-[10px] uppercase font-semibold text-destructive">
                                                Zero
                                              </span>
                                            )}
                                            {!r.isZero && r.isLow && (
                                              <span className="ml-2 text-[10px] uppercase font-semibold text-amber-600 dark:text-amber-400">
                                                Low
                                              </span>
                                            )}
                                          </TableCell>
                                          <TableCell className="text-muted-foreground text-sm">{r.unit}</TableCell>
                                          <TableCell className="text-right">{fmtNum(r.opening)}</TableCell>
                                          <TableCell className="text-right">{fmtNum(r.receipt)}</TableCell>
                                          <TableCell className="text-right text-rose-600 dark:text-rose-400">
                                            {fmtNum(r.consumed)}
                                          </TableCell>
                                          <TableCell className="text-right font-medium">{fmtNum(r.qty)}</TableCell>
                                          {isSuperAdmin && (
                                            <TableCell className="text-right font-semibold">
                                              {fmtCurrency(r.value)}
                                            </TableCell>
                                          )}
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Two-column lower section: Top items + Low stock alerts */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                Top {topItems.length || 10} Items {isSuperAdmin ? "by Value" : "by Quantity"}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      {isSuperAdmin && <TableHead className="text-right">Value</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={isSuperAdmin ? 5 : 4} className="text-center text-muted-foreground py-6">
                          No data.
                        </TableCell>
                      </TableRow>
                    ) : (
                      topItems.map((r, i) => (
                        <TableRow key={`top-${r.code}-${i}`}>
                          <TableCell className="font-mono text-xs">{r.code}</TableCell>
                          <TableCell className="font-medium">{r.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{r.category}</TableCell>
                          <TableCell className="text-right">
                            {fmtNum(r.qty)} <span className="text-xs text-muted-foreground">{r.unit}</span>
                          </TableCell>
                          {isSuperAdmin && (
                            <TableCell className="text-right font-semibold">{fmtCurrency(r.value)}</TableCell>
                          )}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                Low / Zero Stock Alerts
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                      <TableHead className="text-right">Threshold</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStockItems.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                          No low or zero stock items 🎉
                        </TableCell>
                      </TableRow>
                    ) : (
                      lowStockItems.map((r, i) => (
                        <TableRow key={`low-${r.code}-${i}`}>
                          <TableCell className="font-mono text-xs">{r.code}</TableCell>
                          <TableCell className="font-medium">
                            {r.name}
                            <div className="text-xs text-muted-foreground">{r.category}</div>
                          </TableCell>
                          <TableCell className="text-right">
                            {fmtNum(r.qty)} <span className="text-xs text-muted-foreground">{r.unit}</span>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {r.threshold > 0 ? fmtNum(r.threshold) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold",
                                r.isZero
                                  ? "bg-destructive/15 text-destructive"
                                  : "bg-amber-500/15 text-amber-700 dark:text-amber-400",
                              )}
                            >
                              {r.isZero ? "Zero" : "Low"}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}

/* ----------------------- helpers ----------------------- */

const toneClasses: Record<string, string> = {
  violet: "bg-violet-500/15 text-violet-500",
  blue: "bg-blue-500/15 text-blue-500",
  emerald: "bg-emerald-500/15 text-emerald-500",
  amber: "bg-amber-500/15 text-amber-500",
  rose: "bg-rose-500/15 text-rose-500",
  primary: "bg-primary/15 text-primary",
};

function KpiCard({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: keyof typeof toneClasses;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={cn("rounded-lg p-2", toneClasses[tone])}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          <div className="text-lg font-semibold truncate">{value}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
      No data for this period.
    </div>
  );
}
