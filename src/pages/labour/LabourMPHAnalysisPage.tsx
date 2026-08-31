import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth, subMonths, parseISO } from "date-fns";
import { Activity, Gauge, TrendingUp, TrendingDown, CalendarIcon, Factory, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine, PieChart as RechartsPie, Pie, Cell,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function LabourMPHAnalysisPage() {
  const [dateRange, setDateRange] = useState("month");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [customStart, setCustomStart] = useState<Date | undefined>(subDays(new Date(), 7));
  const [customEnd, setCustomEnd] = useState<Date | undefined>(new Date());

  const getDateFilter = () => {
    const today = new Date();
    switch (dateRange) {
      case "today":
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "week":
        return { start: format(subDays(today, 7), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "month":
        return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(endOfMonth(today), "yyyy-MM-dd") };
      case "lastMonth": {
        const lastMonth = subMonths(today, 1);
        return { start: format(startOfMonth(lastMonth), "yyyy-MM-dd"), end: format(endOfMonth(lastMonth), "yyyy-MM-dd") };
      }
      case "custom":
        if (customStart && customEnd) {
          return { start: format(customStart, "yyyy-MM-dd"), end: format(customEnd, "yyyy-MM-dd") };
        }
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      default:
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    }
  };

  const { start, end } = getDateFilter();

  const { data: departments = [] } = useQuery({
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
      const { data, error } = await supabase
        .from("mph_calculating_numbers")
        .select("department_id, sub_department_id, mph_number")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: productionEntries = [], isLoading: loadingProduction } = useQuery({
    queryKey: ["mph-analysis-production", start, end, selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("production_entries")
        .select("department_id, sub_department_id, quantity_produced, entry_date")
        .gte("entry_date", start)
        .lte("entry_date", end);
      if (selectedDepartment !== "all") query = query.eq("department_id", selectedDepartment);
      const { data, error } = await query.limit(10000);
      if (error) throw error;
      return data;
    },
  });

  const { data: usedMphEntries = [], isLoading: loadingUsed } = useQuery({
    queryKey: ["mph-analysis-used", start, end, selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("labour_productivity_targets")
        .select("department_id, mph, target_date, employee_id")
        .gte("target_date", start)
        .lte("target_date", end);
      if (selectedDepartment !== "all") query = query.eq("department_id", selectedDepartment);
      const { data, error } = await query.limit(10000);
      if (error) throw error;
      return data;
    },
  });

  const isLoading = loadingProduction || loadingUsed;

  // Aggregate authorized MPH + production output per department and per day
  const analysis = useMemo(() => {
    const findMphNumber = (departmentId: string | null, subDepartmentId: string | null) => {
      const row = mphNumbers.find(
        (m) => m.department_id === departmentId && (m.sub_department_id || null) === (subDepartmentId || null)
      );
      return row ? Number(row.mph_number || 0) : 0;
    };

    const byDept: Record<string, { output: number; authorized: number; used: number; days: Set<string>; workers: Set<string> }> = {};
    const byDay: Record<string, { output: number; authorized: number; used: number }> = {};

    const deptBucket = (id: string) => {
      if (!byDept[id]) byDept[id] = { output: 0, authorized: 0, used: 0, days: new Set(), workers: new Set() };
      return byDept[id];
    };
    const dayBucket = (date: string) => {
      if (!byDay[date]) byDay[date] = { output: 0, authorized: 0, used: 0 };
      return byDay[date];
    };

    productionEntries.forEach((entry) => {
      if (!entry.department_id) return;
      const qty = Number(entry.quantity_produced || 0);
      const authorized = qty * findMphNumber(entry.department_id, entry.sub_department_id);
      const dept = deptBucket(entry.department_id);
      dept.output += qty;
      dept.authorized += authorized;
      dept.days.add(entry.entry_date);
      const day = dayBucket(entry.entry_date);
      day.output += qty;
      day.authorized += authorized;
    });

    usedMphEntries.forEach((entry) => {
      if (!entry.department_id) return;
      const mph = Number(entry.mph || 0);
      const dept = deptBucket(entry.department_id);
      dept.used += mph;
      if (entry.employee_id) dept.workers.add(entry.employee_id);
      dayBucket(entry.target_date).used += mph;
    });

    return { byDept, byDay };
  }, [productionEntries, usedMphEntries, mphNumbers]);

  const departmentRows = useMemo(() => {
    return departments
      .map((dept) => {
        const stats = analysis.byDept[dept.id];
        if (!stats) return null;
        const net = stats.authorized - stats.used;
        return {
          id: dept.id,
          name: dept.name,
          output: stats.output,
          authorized: stats.authorized,
          used: stats.used,
          net,
          days: stats.days.size,
          workers: stats.workers.size,
          mphPerUnit: stats.output > 0 ? stats.used / stats.output : 0,
          efficiency: stats.used > 0 ? (stats.authorized / stats.used) * 100 : 0,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => b.authorized - a.authorized);
  }, [departments, analysis]);

  const dailyRows = useMemo(() => {
    return Object.entries(analysis.byDay)
      .map(([date, stats]) => ({
        date,
        label: format(parseISO(date), "dd MMM"),
        output: stats.output,
        authorized: stats.authorized,
        used: stats.used,
        net: stats.authorized - stats.used,
        efficiency: stats.used > 0 ? (stats.authorized / stats.used) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [analysis]);

  const totals = useMemo(() => {
    const output = departmentRows.reduce((sum, r) => sum + r.output, 0);
    const authorized = departmentRows.reduce((sum, r) => sum + r.authorized, 0);
    const used = departmentRows.reduce((sum, r) => sum + r.used, 0);
    // Departments with used MPH but no production still count toward totals
    const usedOnly = Object.values(analysis.byDept).reduce((sum, d) => sum + d.used, 0) - used;
    const totalUsed = used + Math.max(usedOnly, 0);
    return {
      output,
      authorized,
      used: totalUsed,
      net: authorized - totalUsed,
      efficiency: totalUsed > 0 ? (authorized / totalUsed) * 100 : 0,
    };
  }, [departmentRows, analysis]);

  const pieData = departmentRows
    .filter((r) => r.output > 0)
    .map((r) => ({ name: r.name, value: r.output }));

  const departmentChartData = departmentRows.map((r) => ({
    name: r.name.length > 14 ? r.name.slice(0, 14) + "…" : r.name,
    Authorized: Number(r.authorized.toFixed(1)),
    Used: Number(r.used.toFixed(1)),
  }));

  const trendChartData = dailyRows.map((r) => ({
    name: r.label,
    Output: r.output,
    Authorized: Number(r.authorized.toFixed(1)),
    Used: Number(r.used.toFixed(1)),
    Efficiency: Number(r.efficiency.toFixed(1)),
  }));

  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });

  return (
    <ERPLayout>
      <div className="space-y-6 p-4 md:p-6">
        <PageHeader
          title="MPH Analysis"
          description="Analysis of MPH usage against production output — authorized vs used man-per-hour"
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Date Range</label>
            <Select value={dateRange} onValueChange={setDateRange}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">Last 7 Days</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="lastMonth">Last Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {dateRange === "custom" && (
            <>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">From</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[150px] justify-start">
                      <CalendarIcon className="h-4 w-4 mr-2" />
                      {customStart ? format(customStart, "dd MMM yyyy") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={customStart} onSelect={setCustomStart} />
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">To</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[150px] justify-start">
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
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Department</label>
            <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dept) => (
                  <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard title="Production Output" value={fmt(totals.output)} icon={Factory} description="Total quantity produced" />
          <MetricCard title="Authorized MPH" value={fmt(totals.authorized)} icon={Gauge} description="Earned from production output" />
          <MetricCard title="Used MPH" value={fmt(totals.used)} icon={Users} description="Consumed by labour deployment" />
          <MetricCard
            title="Net MPH"
            value={`${totals.net > 0 ? "+" : ""}${fmt(totals.net)}`}
            icon={totals.net >= 0 ? TrendingUp : TrendingDown}
            iconColor={totals.net >= 0 ? "text-green-600" : "text-red-600"}
            description={totals.net >= 0 ? "MPH saved" : "MPH loss"}
          />
          <MetricCard
            title="MPH Efficiency"
            value={`${fmt(totals.efficiency)}%`}
            icon={Activity}
            iconColor={totals.efficiency >= 100 ? "text-green-600" : "text-red-600"}
            description="Authorized ÷ Used"
          />
        </div>

        {/* Trend charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Daily MPH vs Production Output</CardTitle>
            </CardHeader>
            <CardContent>
              {trendChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: "MPH", angle: -90, position: "insideLeft", fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: "Output", angle: 90, position: "insideRight", fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar yAxisId="right" dataKey="Output" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="left" type="monotone" dataKey="Authorized" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line yAxisId="left" type="monotone" dataKey="Used" stroke="#ef4444" strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Daily MPH Efficiency Trend</CardTitle>
            </CardHeader>
            <CardContent>
              {trendChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} unit="%" />
                    <Tooltip formatter={(value: number) => `${value}%`} />
                    <ReferenceLine y={100} stroke="#6b7280" strokeDasharray="4 4" label={{ value: "100%", fontSize: 10 }} />
                    <Line type="monotone" dataKey="Efficiency" stroke="#8b5cf6" strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Department charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Authorized vs Used MPH by Department</CardTitle>
            </CardHeader>
            <CardContent>
              {departmentChartData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={departmentChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="Authorized" fill="#10b981" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Used" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Production Output Share by Department</CardTitle>
            </CardHeader>
            <CardContent>
              {pieData.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <RechartsPie>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={110} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {pieData.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => fmt(value)} />
                  </RechartsPie>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Department summary table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Department Summary — {format(parseISO(start), "dd MMM yyyy")} to {format(parseISO(end), "dd MMM yyyy")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs font-semibold">Department</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Days</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Workers</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Production Output</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Authorized MPH</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Used MPH</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Net MPH</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Used MPH / Unit</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Efficiency</TableHead>
                    <TableHead className="text-xs font-semibold text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">Loading...</TableCell></TableRow>
                  ) : departmentRows.length === 0 ? (
                    <TableRow><TableCell colSpan={10} className="text-center text-sm text-muted-foreground py-8">No data available for the selected period</TableCell></TableRow>
                  ) : (
                    <>
                      {departmentRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium text-sm">{row.name}</TableCell>
                          <TableCell className="text-right text-sm">{row.days}</TableCell>
                          <TableCell className="text-right text-sm">{row.workers}</TableCell>
                          <TableCell className="text-right text-sm">{fmt(row.output)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{fmt(row.authorized)}</TableCell>
                          <TableCell className="text-right text-sm font-medium">{fmt(row.used)}</TableCell>
                          <TableCell className={`text-right text-sm font-bold ${row.net > 0 ? "text-green-600" : row.net < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                            {row.net > 0 ? "+" : ""}{fmt(row.net)}
                          </TableCell>
                          <TableCell className="text-right text-sm">{row.output > 0 ? row.mphPerUnit.toFixed(3) : "—"}</TableCell>
                          <TableCell className={`text-right text-sm font-medium ${row.efficiency >= 100 ? "text-green-600" : row.used > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                            {row.used > 0 ? `${fmt(row.efficiency)}%` : "—"}
                          </TableCell>
                          <TableCell className="text-center">
                            {row.authorized === 0 && row.used === 0 ? (
                              <Badge variant="outline" className="text-[10px] px-1">—</Badge>
                            ) : row.net >= 0 ? (
                              <Badge className="bg-green-100 text-green-700 text-[10px] px-1">Saved</Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-700 text-[10px] px-1">Loss</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="bg-muted/50 font-bold">
                        <TableCell>Total</TableCell>
                        <TableCell />
                        <TableCell />
                        <TableCell className="text-right text-sm">{fmt(totals.output)}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(totals.authorized)}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(totals.used)}</TableCell>
                        <TableCell className={`text-right text-sm ${totals.net > 0 ? "text-green-600" : totals.net < 0 ? "text-red-600" : ""}`}>
                          {totals.net > 0 ? "+" : ""}{fmt(totals.net)}
                        </TableCell>
                        <TableCell />
                        <TableCell className={`text-right text-sm ${totals.efficiency >= 100 ? "text-green-600" : totals.used > 0 ? "text-red-600" : ""}`}>
                          {totals.used > 0 ? `${fmt(totals.efficiency)}%` : "—"}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Daily breakdown table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Daily Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[420px]">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs font-semibold">Date</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Production Output</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Authorized MPH</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Used MPH</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Net MPH</TableHead>
                    <TableHead className="text-xs font-semibold text-right">Efficiency</TableHead>
                    <TableHead className="text-xs font-semibold text-center">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyRows.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No data available for the selected period</TableCell></TableRow>
                  ) : (
                    dailyRows.map((row) => (
                      <TableRow key={row.date}>
                        <TableCell className="font-medium text-sm">{format(parseISO(row.date), "dd MMM yyyy")}</TableCell>
                        <TableCell className="text-right text-sm">{fmt(row.output)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{fmt(row.authorized)}</TableCell>
                        <TableCell className="text-right text-sm font-medium">{fmt(row.used)}</TableCell>
                        <TableCell className={`text-right text-sm font-bold ${row.net > 0 ? "text-green-600" : row.net < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                          {row.net > 0 ? "+" : ""}{fmt(row.net)}
                        </TableCell>
                        <TableCell className={`text-right text-sm font-medium ${row.efficiency >= 100 ? "text-green-600" : row.used > 0 ? "text-red-600" : "text-muted-foreground"}`}>
                          {row.used > 0 ? `${fmt(row.efficiency)}%` : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.authorized === 0 && row.used === 0 ? (
                            <Badge variant="outline" className="text-[10px] px-1">—</Badge>
                          ) : row.net >= 0 ? (
                            <Badge className="bg-green-100 text-green-700 text-[10px] px-1"><TrendingUp className="h-3 w-3" /></Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700 text-[10px] px-1"><TrendingDown className="h-3 w-3" /></Badge>
                          )}
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
    </ERPLayout>
  );
}
