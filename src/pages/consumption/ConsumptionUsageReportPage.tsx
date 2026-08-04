import { useState, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CalendarIcon, BarChart3, TrendingUp, Printer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, eachMonthOfInterval, subMonths } from "date-fns";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, ReferenceLine } from "recharts";

export default function ConsumptionUsageReportPage() {
  const [viewMode, setViewMode] = useState<"daily" | "monthly">("daily");
  const [selectedMaterialId, setSelectedMaterialId] = useState<string>("");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);

  // Fetch all active raw materials for dropdown
  const { data: materials } = useQuery({
    queryKey: ["consumption-report-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Date range based on view mode
  const dateRange = useMemo(() => {
    if (viewMode === "daily") {
      const start = startOfMonth(selectedDate);
      const end = endOfMonth(selectedDate);
      return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
    } else {
      const end = endOfMonth(selectedDate);
      const start = format(startOfMonth(subMonths(selectedDate, 11)), "yyyy-MM-dd");
      return { start, end: format(end, "yyyy-MM-dd") };
    }
  }, [viewMode, selectedDate]);

  // Fetch stock closing data for the selected material
  const { data: closingData } = useQuery({
    queryKey: ["consumption-usage-closing", selectedMaterialId, dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_stock_closing")
        .select("closing_date, actual_consumption, opening_quantity, receipt_quantity, closing_quantity")
        .eq("raw_material_id", selectedMaterialId)
        .gte("closing_date", dateRange.start)
        .lte("closing_date", dateRange.end)
        .order("closing_date");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedMaterialId,
  });

  // Fetch BOM standard for variance calculation
  const { data: bomData } = useQuery({
    queryKey: ["consumption-usage-bom", selectedMaterialId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_bom")
        .select("product_id, standard_quantity")
        .eq("raw_material_id", selectedMaterialId)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedMaterialId,
  });

  // Fetch production data for standard calculation
  const { data: productionData } = useQuery({
    queryKey: ["consumption-usage-production", dateRange.start, dateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_production_entry")
        .select("product_id, quantity_produced, entry_date")
        .gte("entry_date", dateRange.start)
        .lte("entry_date", dateRange.end);
      if (error) throw error;
      return data;
    },
    enabled: !!selectedMaterialId,
  });

  // Fetch product names for BOM breakdown display
  const { data: productsData } = useQuery({
    queryKey: ["consumption-products-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_products")
        .select("id, name, code");
      if (error) throw error;
      return data;
    },
  });

  const productLookup = useMemo(() => {
    const map: Record<string, string> = {};
    productsData?.forEach((p) => { map[p.id] = p.name || p.code; });
    return map;
  }, [productsData]);

  const selectedMaterial = materials?.find((m) => m.id === selectedMaterialId);
  const unit = selectedMaterial?.unit || "kg";

  // Build chart data
  const chartData = useMemo(() => {
    if (!closingData || !bomData || !productionData) return [];

    if (viewMode === "daily") {
      const start = startOfMonth(selectedDate);
      const end = endOfMonth(selectedDate);
      const days = eachDayOfInterval({ start, end });

      return days.map((day) => {
        const dateStr = format(day, "yyyy-MM-dd");
        const closing = closingData.find((c) => c.closing_date === dateStr);
        const actual = Number(closing?.actual_consumption || 0);

        const dayProduction = productionData.filter((p) => p.entry_date === dateStr);
        let standard = 0;
        const bomBreakdown: { productName: string; produced: number; bomRate: number; subtotal: number }[] = [];
        dayProduction.forEach((p) => {
          const bom = bomData.find((b) => b.product_id === p.product_id);
          if (bom) {
            const subtotal = Number(bom.standard_quantity) * Number(p.quantity_produced);
            standard += subtotal;
            bomBreakdown.push({
              productName: productLookup[p.product_id] || p.product_id,
              produced: Number(p.quantity_produced),
              bomRate: Number(bom.standard_quantity),
              subtotal,
            });
          }
        });

        return {
          label: format(day, "dd"),
          fullDate: format(day, "MMM dd"),
          actual,
          standard,
          variance: actual - standard,
          opening: Number(closing?.opening_quantity || 0),
          receipts: Number(closing?.receipt_quantity || 0),
          closingBal: Number(closing?.closing_quantity || 0),
          bomBreakdown,
        };
      });
    } else {
      const end = endOfMonth(selectedDate);
      const start = startOfMonth(subMonths(selectedDate, 11));
      const months = eachMonthOfInterval({ start, end });

      return months.map((month) => {
        const monthStart = format(startOfMonth(month), "yyyy-MM-dd");
        const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");

        const monthClosing = closingData.filter(
          (c) => c.closing_date >= monthStart && c.closing_date <= monthEnd
        );
        const actual = monthClosing.reduce((s, c) => s + Number(c.actual_consumption || 0), 0);
        const totalReceipts = monthClosing.reduce((s, c) => s + Number(c.receipt_quantity || 0), 0);

        // Opening = first day's opening, Closing = last day's closing
        const sorted = [...monthClosing].sort((a, b) => a.closing_date.localeCompare(b.closing_date));
        const monthOpening = sorted.length > 0 ? Number(sorted[0].opening_quantity || 0) : 0;
        const monthClosingBal = sorted.length > 0 ? Number(sorted[sorted.length - 1].closing_quantity || 0) : 0;

        const monthProduction = productionData.filter(
          (p) => p.entry_date >= monthStart && p.entry_date <= monthEnd
        );
        let standard = 0;
        const bomBreakdown: { productName: string; produced: number; bomRate: number; subtotal: number }[] = [];
        // Aggregate by product for the month
        const prodAgg: Record<string, number> = {};
        monthProduction.forEach((p) => {
          prodAgg[p.product_id] = (prodAgg[p.product_id] || 0) + Number(p.quantity_produced);
        });
        Object.entries(prodAgg).forEach(([productId, totalProduced]) => {
          const bom = bomData.find((b) => b.product_id === productId);
          if (bom) {
            const subtotal = Number(bom.standard_quantity) * totalProduced;
            standard += subtotal;
            bomBreakdown.push({
              productName: productLookup[productId] || productId,
              produced: totalProduced,
              bomRate: Number(bom.standard_quantity),
              subtotal,
            });
          }
        });

        return {
          label: format(month, "MMM yy"),
          fullDate: format(month, "MMMM yyyy"),
          actual,
          standard,
          variance: actual - standard,
          opening: monthOpening,
          receipts: totalReceipts,
          closingBal: monthClosingBal,
          bomBreakdown,
        };
      });
    }
  }, [closingData, bomData, productionData, viewMode, selectedDate, productLookup]);

  const totals = useMemo(() => {
    const totalActual = chartData.reduce((s, d) => s + d.actual, 0);
    const totalStandard = chartData.reduce((s, d) => s + d.standard, 0);
    return {
      actual: totalActual,
      standard: totalStandard,
      variance: totalActual - totalStandard,
      variancePct: totalStandard > 0 ? ((totalActual - totalStandard) / totalStandard * 100) : 0,
    };
  }, [chartData]);

  const usageChartConfig = {
    actual: { label: "Actual", color: "hsl(var(--primary))" },
    standard: { label: "Standard", color: "hsl(var(--muted-foreground))" },
  };

  const varianceChartConfig = {
    variance: { label: "Variance", color: "hsl(var(--destructive))" },
  };

  const handlePrint = () => {
    if (!selectedMaterial || chartData.length === 0) return;
    const filteredData = chartData.filter(d => d.actual > 0 || d.standard > 0);
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    
    const tableRows = filteredData.map(d => {
      const pct = d.standard > 0 ? (d.variance / d.standard * 100) : d.actual > 0 ? 100 : 0;
      return `<tr>
        <td>${d.fullDate}</td>
        <td style="text-align:right">${d.actual.toFixed(2)}</td>
        <td style="text-align:right">${d.standard.toFixed(2)}</td>
        <td style="text-align:right;color:${d.variance > 0 ? '#dc2626' : d.variance < 0 ? '#16a34a' : 'inherit'}">${d.variance > 0 ? '+' : ''}${d.variance.toFixed(2)}</td>
        <td style="text-align:right;${Math.abs(pct) > 10 ? 'color:#dc2626;font-weight:bold' : ''}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</td>
      </tr>`;
    }).join("");
    
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Material Usage Report - ${selectedMaterial.name}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; color: #111; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { font-size: 13px; color: #555; margin-bottom: 16px; }
        .summary { display: flex; gap: 24px; margin-bottom: 20px; }
        .summary div { border: 1px solid #ddd; border-radius: 6px; padding: 10px 16px; }
        .summary .label { font-size: 12px; color: #666; }
        .summary .value { font-size: 20px; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th, td { border: 1px solid #ddd; padding: 6px 10px; }
        th { background: #f3f4f6; text-align: left; font-weight: 600; }
        .total-row { font-weight: bold; border-top: 2px solid #333; }
        @media print { body { padding: 0; } }
      </style>
    </head><body>
      <h1>Material Usage Report — ${selectedMaterial.code} — ${selectedMaterial.name}</h1>
      <div class="meta">${viewMode === 'daily' ? format(selectedDate, 'MMMM yyyy') : 'Last 12 Months up to ' + format(selectedDate, 'MMM yyyy')} | Unit: ${unit}</div>
      <div class="summary">
        <div><div class="label">Total Actual</div><div class="value">${totals.actual.toFixed(2)} ${unit}</div></div>
        <div><div class="label">Total Standard</div><div class="value">${totals.standard.toFixed(2)} ${unit}</div></div>
        <div><div class="label">Variance</div><div class="value" style="color:${totals.variance > 0 ? '#dc2626' : '#16a34a'}">${totals.variance > 0 ? '+' : ''}${totals.variance.toFixed(2)} ${unit}</div></div>
        <div><div class="label">Variance %</div><div class="value">${totals.variancePct > 0 ? '+' : ''}${totals.variancePct.toFixed(1)}%</div></div>
      </div>
      <table>
        <thead><tr>
          <th>${viewMode === 'daily' ? 'Date' : 'Month'}</th>
          <th style="text-align:right">Actual (${unit})</th>
          <th style="text-align:right">Standard (${unit})</th>
          <th style="text-align:right">Variance (${unit})</th>
          <th style="text-align:right">Variance %</th>
        </tr></thead>
        <tbody>
          ${tableRows}
          <tr class="total-row">
            <td>Total</td>
            <td style="text-align:right">${totals.actual.toFixed(2)}</td>
            <td style="text-align:right">${totals.standard.toFixed(2)}</td>
            <td style="text-align:right;color:${totals.variance > 0 ? '#dc2626' : '#16a34a'}">${totals.variance > 0 ? '+' : ''}${totals.variance.toFixed(2)}</td>
            <td style="text-align:right">${totals.variancePct > 0 ? '+' : ''}${totals.variancePct.toFixed(1)}%</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:12px;font-size:11px;color:#888;">Printed on ${format(new Date(), 'dd MMM yyyy, hh:mm a')}</div>
      <script>window.onload=function(){window.print();}</script>
    </body></html>`);
    printWindow.document.close();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Material Usage Report</h1>
            <p className="page-description">Daily/Monthly usage trends and variance analysis for selected material</p>
          </div>
          {selectedMaterialId && chartData.some(d => d.actual > 0 || d.standard > 0) && (
            <Button variant="outline" onClick={handlePrint}>
              <Printer className="mr-2 h-4 w-4" />
              Print Report
            </Button>
          )}
        </div>

        {/* Controls */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="flex-1 min-w-[250px]">
                <label className="text-sm font-medium mb-1.5 block">Select Material</label>
                <SearchableSelect
                  value={selectedMaterialId}
                  onValueChange={setSelectedMaterialId}
                  options={(materials || []).map((m) => ({
                    value: m.id,
                    label: `${m.code} — ${m.name}`,
                  }))}
                  placeholder="Search a raw material…"
                  emptyText="No materials match."
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">View</label>
                <Select value={viewMode} onValueChange={(v: any) => setViewMode(v)}>
                  <SelectTrigger className="w-[130px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  {viewMode === "daily" ? "Month" : "Up to"}
                </label>
                <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[180px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {viewMode === "daily"
                        ? format(selectedDate, "MMMM yyyy")
                        : format(selectedDate, "MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={selectedDate}
                      onSelect={(date) => {
                        if (date) { setSelectedDate(date); setIsCalendarOpen(false); }
                      }}
                      disabled={(date) => date > new Date()}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </CardContent>
        </Card>

        {!selectedMaterialId ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-40" />
              <p className="text-lg font-medium">Select a material to view its usage report</p>
              <p className="text-sm mt-1">Choose from the dropdown above to see daily/monthly trends and variance</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Actual</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totals.actual.toFixed(2)}</div>
                  <p className="text-xs text-muted-foreground">{unit}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Standard</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totals.standard.toFixed(2)}</div>
                  <p className="text-xs text-muted-foreground">{unit}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Variance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn("text-2xl font-bold", totals.variance > 0 ? "text-destructive" : "text-green-600")}>
                    {totals.variance > 0 ? "+" : ""}{totals.variance.toFixed(2)}
                  </div>
                  <p className="text-xs text-muted-foreground">{unit}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Variance %</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn("text-2xl font-bold", totals.variancePct > 5 ? "text-destructive" : totals.variancePct < -5 ? "text-green-600" : "")}>
                    {totals.variancePct > 0 ? "+" : ""}{totals.variancePct.toFixed(1)}%
                  </div>
                  <p className="text-xs text-muted-foreground">of standard</p>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Usage Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    {viewMode === "daily" ? "Daily" : "Monthly"} Usage — {selectedMaterial?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={usageChartConfig} className="h-[300px] w-full">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis fontSize={12} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="actual" fill="var(--color-actual)" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="standard" fill="var(--color-standard)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {/* Variance Chart */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Variance Trend — {selectedMaterial?.name}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={varianceChartConfig} className="h-[300px] w-full">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" fontSize={12} />
                      <YAxis fontSize={12} />
                      <ChartTooltip
                        content={<ChartTooltipContent />}
                      />
                      <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar
                        dataKey="variance"
                        fill="var(--color-variance)"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            {/* Data Table */}
            <Card>
              <CardHeader>
                <CardTitle>{viewMode === "daily" ? "Daily" : "Monthly"} Usage Data</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{viewMode === "daily" ? "Date" : "Month"}</TableHead>
                      <TableHead className="text-right">Actual ({unit})</TableHead>
                      <TableHead className="text-right">Standard ({unit})</TableHead>
                      <TableHead className="text-right">Variance ({unit})</TableHead>
                      <TableHead className="text-right">Variance %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chartData.filter(d => d.actual > 0 || d.standard > 0).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No consumption data found for this period
                        </TableCell>
                      </TableRow>
                    ) : (
                      chartData
                        .filter(d => d.actual > 0 || d.standard > 0)
                        .map((d, i) => {
                          const pct = d.standard > 0 ? (d.variance / d.standard * 100) : d.actual > 0 ? 100 : 0;
                          return (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{d.fullDate}</TableCell>
                              <TableCell className="text-right">{d.actual.toFixed(2)}</TableCell>
                              <TableCell className="text-right">
                                <div>{d.standard.toFixed(2)}</div>
                                {d.bomBreakdown && d.bomBreakdown.length > 0 && (
                                  <div className="mt-1 space-y-0.5">
                                    {d.bomBreakdown.map((b, bi) => (
                                      <div key={bi} className="text-xs text-muted-foreground">
                                        {b.productName}: {b.produced} × {b.bomRate} = {b.subtotal.toFixed(2)}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={d.variance > 0 ? "text-destructive" : d.variance < 0 ? "text-green-600" : ""}>
                                  {d.variance > 0 ? "+" : ""}{d.variance.toFixed(2)}
                                </span>
                              </TableCell>
                              <TableCell className="text-right">
                                <span className={Math.abs(pct) > 10 ? "text-destructive font-semibold" : ""}>
                                  {pct > 0 ? "+" : ""}{pct.toFixed(1)}%
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })
                    )}
                    {chartData.filter(d => d.actual > 0 || d.standard > 0).length > 0 && (
                      <TableRow className="font-bold border-t-2">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">{totals.actual.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{totals.standard.toFixed(2)}</TableCell>
                        <TableCell className="text-right">
                          <span className={totals.variance > 0 ? "text-destructive" : totals.variance < 0 ? "text-green-600" : ""}>
                            {totals.variance > 0 ? "+" : ""}{totals.variance.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          {totals.variancePct > 0 ? "+" : ""}{totals.variancePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            {/* Monthly Summary - Opening, Receipts, Usage, Closing */}
            <Card>
              <CardHeader>
                <CardTitle>
                  {viewMode === "daily" ? "Daily" : "Monthly"} Summary — Opening, Receipts, Usage & Closing
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{viewMode === "daily" ? "Date" : "Month"}</TableHead>
                      <TableHead className="text-right">Opening ({unit})</TableHead>
                      <TableHead className="text-right">Receipts ({unit})</TableHead>
                      <TableHead className="text-right">Usage ({unit})</TableHead>
                      <TableHead className="text-right">Closing ({unit})</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {chartData.filter(d => d.opening > 0 || d.receipts > 0 || d.actual > 0 || d.closingBal > 0).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No data found for this period
                        </TableCell>
                      </TableRow>
                    ) : (
                      chartData
                        .filter(d => d.opening > 0 || d.receipts > 0 || d.actual > 0 || d.closingBal > 0)
                        .map((d, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium">{d.fullDate}</TableCell>
                            <TableCell className="text-right">{d.opening.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{d.receipts.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{d.actual.toFixed(2)}</TableCell>
                            <TableCell className="text-right">{d.closingBal.toFixed(2)}</TableCell>
                          </TableRow>
                        ))
                    )}
                    {(() => {
                      const filtered = chartData.filter(d => d.opening > 0 || d.receipts > 0 || d.actual > 0 || d.closingBal > 0);
                      if (filtered.length === 0) return null;
                      const totalReceipts = filtered.reduce((s, d) => s + d.receipts, 0);
                      const totalUsage = filtered.reduce((s, d) => s + d.actual, 0);
                      const firstOpening = filtered[0]?.opening || 0;
                      const lastClosing = filtered[filtered.length - 1]?.closingBal || 0;
                      return (
                        <TableRow className="font-bold border-t-2">
                          <TableCell>Total / Net</TableCell>
                          <TableCell className="text-right">{firstOpening.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{totalReceipts.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{totalUsage.toFixed(2)}</TableCell>
                          <TableCell className="text-right">{lastClosing.toFixed(2)}</TableCell>
                        </TableRow>
                      );
                    })()}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ERPLayout>
  );
}
