import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calendar as CalendarIcon, Package, Boxes, Building2, TrendingUp, AlertCircle, ChevronRight, ChevronDown } from "lucide-react";
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

export default function DailyClosingDashboard() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [expandedDepts, setExpandedDepts] = useState<Set<string>>(new Set());

  const toggleDept = (name: string) => {
    setExpandedDepts((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const trendStartStr = format(subDays(selectedDate, 13), "yyyy-MM-dd");

  // Closing data for the selected date
  const { data: closingData, isLoading } = useQuery({
    queryKey: ["daily-closing-dashboard", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select(`
          *,
          planning_items(id, code, name, unit, costing_value),
          production_departments(id, name)
        `)
        .eq("closing_date", dateStr)
        .order("created_at");
      if (error) throw error;
      return data || [];
    },
  });

  const [trendMode, setTrendMode] = useState<"total" | "department">("total");

  // 14-day trend data
  const { data: trendData } = useQuery({
    queryKey: ["daily-closing-trend", trendStartStr, dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_stock_closing")
        .select("closing_date, closing_quantity, planning_items(costing_value), production_departments(name)")
        .gte("closing_date", trendStartStr)
        .lte("closing_date", dateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // KPIs
  const kpis = useMemo(() => {
    if (!closingData) return { items: 0, units: 0, departments: 0, value: 0, zeroStock: 0 };
    const deptSet = new Set<string>();
    let units = 0;
    let value = 0;
    let zeroStock = 0;
    closingData.forEach((row: any) => {
      const qty = Number(row.closing_quantity) || 0;
      const cv = Number(row.planning_items?.costing_value) || 0;
      units += qty;
      value += qty * cv;
      if (qty === 0) zeroStock += 1;
      if (row.department_id) deptSet.add(row.department_id);
    });
    return {
      items: closingData.length,
      units,
      departments: deptSet.size,
      value,
      zeroStock,
    };
  }, [closingData]);

  // Department breakdown
  const departmentBreakdown = useMemo(() => {
    if (!closingData) return [] as Array<{
      name: string;
      qty: number;
      enteredQty: number;
      value: number;
      items: number;
      rows: Array<{ code: string; name: string; unit: string; enteredQty: number; multiplier: number; qty: number; value: number }>;
    }>;
    const map: Record<string, { name: string; qty: number; enteredQty: number; value: number; items: number; rows: Array<{ code: string; name: string; unit: string; enteredQty: number; multiplier: number; qty: number; value: number }> }> = {};
    closingData.forEach((row: any) => {
      const deptName = row.production_departments?.name || "Unassigned";
      const qty = Number(row.closing_quantity) || 0;
      const enteredQty = row.entered_quantity != null ? Number(row.entered_quantity) : qty;
      const multiplier = row.multiplier != null ? Number(row.multiplier) : 1;
      const cv = Number(row.planning_items?.costing_value) || 0;
      if (!map[deptName]) map[deptName] = { name: deptName, qty: 0, enteredQty: 0, value: 0, items: 0, rows: [] };
      map[deptName].qty += qty;
      map[deptName].enteredQty += enteredQty;
      map[deptName].value += qty * cv;
      map[deptName].items += 1;
      map[deptName].rows.push({
        code: row.planning_items?.code || "—",
        name: row.planning_items?.name || "—",
        unit: row.planning_items?.unit || "",
        enteredQty,
        multiplier,
        qty,
        value: qty * cv,
      });
    });
    return Object.values(map).sort((a, b) => b.value - a.value);
  }, [closingData]);

  // Top 10 items by value
  const topItems = useMemo(() => {
    if (!closingData) return [];
    return [...closingData]
      .map((row: any) => {
        const qty = Number(row.closing_quantity) || 0;
        const enteredQty = row.entered_quantity != null ? Number(row.entered_quantity) : qty;
        const multiplier = row.multiplier != null ? Number(row.multiplier) : 1;
        const cv = Number(row.planning_items?.costing_value) || 0;
        return {
          code: row.planning_items?.code || "—",
          name: row.planning_items?.name || "—",
          unit: row.planning_items?.unit || "",
          department: row.production_departments?.name || "Unassigned",
          enteredQty,
          multiplier,
          qty,
          value: qty * cv,
        };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [closingData]);

  // Trend by day (total)
  const trendChart = useMemo(() => {
    if (!trendData) return [];
    const map: Record<string, { date: string; qty: number; value: number }> = {};
    trendData.forEach((row: any) => {
      const d = row.closing_date as string;
      const qty = Number(row.closing_quantity) || 0;
      const cv = Number(row.planning_items?.costing_value) || 0;
      if (!map[d]) map[d] = { date: d, qty: 0, value: 0 };
      map[d].qty += qty;
      map[d].value += qty * cv;
    });
    return Object.values(map)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => ({ ...r, label: format(new Date(r.date), "dd MMM") }));
  }, [trendData]);

  // Trend by day, broken down by department (wide format for multi-line chart)
  const { trendByDept, deptNames } = useMemo(() => {
    if (!trendData) return { trendByDept: [] as Array<Record<string, any>>, deptNames: [] as string[] };
    const dateDeptQty: Record<string, Record<string, number>> = {};
    const deptSet = new Set<string>();
    trendData.forEach((row: any) => {
      const d = row.closing_date as string;
      const dept = row.production_departments?.name || "Unassigned";
      const qty = Number(row.closing_quantity) || 0;
      deptSet.add(dept);
      if (!dateDeptQty[d]) dateDeptQty[d] = {};
      dateDeptQty[d][dept] = (dateDeptQty[d][dept] || 0) + qty;
    });
    const names = Array.from(deptSet).sort();
    const rows = Object.keys(dateDeptQty)
      .sort()
      .map((d) => {
        const entry: Record<string, any> = { date: d, label: format(new Date(d), "dd MMM") };
        names.forEach((n) => {
          entry[n] = dateDeptQty[d][n] || 0;
        });
        return entry;
      });
    return { trendByDept: rows, deptNames: names };
  }, [trendData]);

  // Stable color palette for department lines
  const deptColors = [
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
    new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);
  const fmtCurrency = (n: number) =>
    "₹" + new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(n);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Daily Closing Dashboard"
          description="Snapshot of end-of-day stock across departments"
          icon={Package}
          iconColor="bg-violet-500/15 text-violet-500"
        >
          <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-start text-left font-normal">
                <CalendarIcon className="mr-2 h-4 w-4" />
                {format(selectedDate, "dd MMM yyyy")}
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
        </PageHeader>

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
          <KpiCard icon={Boxes} label="Items Closed" value={fmtNum(kpis.items)} tone="violet" />
          <KpiCard icon={Package} label="Total Units" value={fmtNum(kpis.units)} tone="blue" />
          <KpiCard icon={Building2} label="Departments" value={fmtNum(kpis.departments)} tone="emerald" />
          <KpiCard icon={AlertCircle} label="Zero-Stock Items" value={fmtNum(kpis.zeroStock)} tone="amber" />
          {isSuperAdmin && (
            <KpiCard icon={TrendingUp} label="Stock Value" value={fmtCurrency(kpis.value)} tone="primary" />
          )}
        </div>

        {/* Charts row */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Closing Quantity by Department</CardTitle>
            </CardHeader>
            <CardContent className="h-[280px] pt-2">
              {departmentBreakdown.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departmentBreakdown}>
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
              <CardTitle className="text-base">14-Day Closing Trend</CardTitle>
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
                  onClick={() => setTrendMode("department")}
                  className={cn(
                    "px-2.5 py-1 rounded-sm transition-colors",
                    trendMode === "department"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  By Department
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
                      <Line
                        type="monotone"
                        dataKey="qty"
                        name="Total Units"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )
              ) : trendByDept.length === 0 || deptNames.length === 0 ? (
                <EmptyState />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendByDept}>
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
                    {deptNames.map((name, idx) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        name={name}
                        stroke={deptColors[idx % deptColors.length]}
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

        {/* Department summary table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Department Summary</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10" />
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Items</TableHead>
                    <TableHead className="text-right">Entered Qty</TableHead>
                    <TableHead className="text-right">Total Qty</TableHead>
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
                  ) : departmentBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 6 : 5} className="text-center text-muted-foreground py-6">
                        No closing entries for this date.
                      </TableCell>
                    </TableRow>
                  ) : (
                    departmentBreakdown.map((d) => {
                      const isOpen = expandedDepts.has(d.name);
                      const sortedRows = [...d.rows].sort((a, b) =>
                        isSuperAdmin ? b.value - a.value : b.qty - a.qty
                      );
                      return (
                        <Fragment key={d.name}>
                          <TableRow
                            key={d.name}
                            className="cursor-pointer"
                            onClick={() => toggleDept(d.name)}
                          >
                            <TableCell className="w-10 p-2">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDept(d.name);
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
                            <TableCell className="font-medium">{d.name}</TableCell>
                            <TableCell className="text-right">{fmtNum(d.items)}</TableCell>
                            <TableCell className="text-right">{fmtNum(d.enteredQty)}</TableCell>
                            <TableCell className="text-right">{fmtNum(d.qty)}</TableCell>
                            {isSuperAdmin && (
                              <TableCell className="text-right font-semibold">{fmtCurrency(d.value)}</TableCell>
                            )}
                          </TableRow>
                          {isOpen && (
                            <TableRow key={`${d.name}-details`} className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={isSuperAdmin ? 6 : 5} className="p-0">
                                <div className="overflow-x-auto p-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-xs uppercase">Code</TableHead>
                                        <TableHead className="text-xs uppercase">Item</TableHead>
                                        <TableHead className="text-xs uppercase">Unit</TableHead>
                                        <TableHead className="text-xs uppercase text-right">Entered Qty</TableHead>
                                        <TableHead className="text-xs uppercase text-right">× Mult</TableHead>
                                        <TableHead className="text-xs uppercase text-right">Closing Qty</TableHead>
                                        {isSuperAdmin && (
                                          <TableHead className="text-xs uppercase text-right">Stock Value</TableHead>
                                        )}
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {sortedRows.map((r, idx) => (
                                        <TableRow key={`${d.name}-${r.code}-${idx}`}>
                                          <TableCell className="font-mono text-xs">{r.code}</TableCell>
                                          <TableCell className="font-medium">{r.name}</TableCell>
                                          <TableCell className="text-muted-foreground text-sm">{r.unit}</TableCell>
                                          <TableCell className="text-right">{fmtNum(r.enteredQty)}</TableCell>
                                          <TableCell className="text-right text-muted-foreground">{r.multiplier}</TableCell>
                                          <TableCell className="text-right">{fmtNum(r.qty)}</TableCell>
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

        {/* Top items table */}
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
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Entered Qty</TableHead>
                    <TableHead className="text-right">× Mult</TableHead>
                    <TableHead className="text-right">Closing Qty</TableHead>
                    {isSuperAdmin && <TableHead className="text-right">Stock Value</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 7 : 6} className="text-center text-muted-foreground py-6">
                        No items to display.
                      </TableCell>
                    </TableRow>
                  ) : (
                    topItems.map((it, idx) => (
                      <TableRow key={`${it.code}-${idx}`}>
                        <TableCell className="font-mono text-xs">{it.code}</TableCell>
                        <TableCell className="font-medium">{it.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">{it.department}</TableCell>
                        <TableCell className="text-right">{fmtNum(it.enteredQty)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{it.multiplier}</TableCell>
                        <TableCell className="text-right">
                          {fmtNum(it.qty)} <span className="text-xs text-muted-foreground">{it.unit}</span>
                        </TableCell>
                        {isSuperAdmin && (
                          <TableCell className="text-right font-semibold">{fmtCurrency(it.value)}</TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string;
  tone: "violet" | "blue" | "emerald" | "amber" | "primary";
}) {
  const toneMap: Record<string, string> = {
    violet: "bg-violet-500/10 text-violet-500",
    blue: "bg-blue-500/10 text-blue-500",
    emerald: "bg-emerald-500/10 text-emerald-500",
    amber: "bg-amber-500/10 text-amber-500",
    primary: "bg-primary/10 text-primary",
  };
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center shrink-0", toneMap[tone])}>
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
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No data available
    </div>
  );
}
