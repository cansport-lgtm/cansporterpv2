import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, subMonths, parseISO, eachDayOfInterval } from "date-fns";
import { User, TrendingUp, Target, Award, CalendarIcon, Search, BarChart3, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeAvatar } from "@/components/labour/EmployeeAvatar";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from "recharts";

const IndividualPerformanceDashboard = () => {
  const [periodMode, setPeriodMode] = useState<"daily" | "monthly" | "custom">("monthly");
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [selectedMonth, setSelectedMonth] = useState(format(new Date(), "yyyy-MM"));
  const [customFrom, setCustomFrom] = useState<Date | undefined>(startOfMonth(new Date()));
  const [customTo, setCustomTo] = useState<Date | undefined>(new Date());
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const getDateRange = () => {
    if (periodMode === "daily") {
      const d = format(selectedDate, "yyyy-MM-dd");
      return { start: d, end: d };
    }
    if (periodMode === "monthly") {
      const [y, m] = selectedMonth.split("-");
      const ms = new Date(parseInt(y), parseInt(m) - 1, 1);
      return { start: format(startOfMonth(ms), "yyyy-MM-dd"), end: format(endOfMonth(ms), "yyyy-MM-dd") };
    }
    return {
      start: customFrom ? format(customFrom, "yyyy-MM-dd") : format(startOfMonth(new Date()), "yyyy-MM-dd"),
      end: customTo ? format(customTo, "yyyy-MM-dd") : format(new Date(), "yyyy-MM-dd"),
    };
  };

  const dateRange = getDateRange();

  const { data: departments = [] } = useQuery({
    queryKey: ["labour-perf-depts"],
    queryFn: async () => {
      const { data } = await supabase.from("production_departments").select("id, name").eq("is_active", true).order("name");
      return data || [];
    },
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["labour-perf-employees"],
    queryFn: async () => {
      const { data } = await supabase
        .from("labour_employees")
        .select("id, employee_code, full_name, department_id, category")
        .eq("is_active", true)
        .order("full_name");
      return data || [];
    },
  });

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["labour-perf-entries", dateRange.start, dateRange.end, selectedEmployee, selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("labour_productivity_targets")
        .select("*, labour_employees!inner(full_name, employee_code, department_id, category, photo_url), qa_processes(name)")
        .gte("target_date", dateRange.start)
        .lte("target_date", dateRange.end);
      if (selectedEmployee !== "all") {
        query = query.eq("employee_id", selectedEmployee);
      }
      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }
      const { data } = await query.limit(5000);
      return data || [];
    },
  });

  // Filter entries
  const filtered = useMemo(() => {
    let result = entries;
    if (selectedDepartment !== "all") {
      result = result.filter((e: any) => e.department_id === selectedDepartment);
    }
    if (selectedEmployee !== "all") {
      result = result.filter((e: any) => e.employee_id === selectedEmployee);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter((e: any) =>
        e.labour_employees?.full_name?.toLowerCase().includes(term) ||
        e.labour_employees?.employee_code?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [entries, selectedDepartment, selectedEmployee, searchTerm]);

  // Summary per employee
  const employeeSummary = useMemo(() => {
    const map = new Map<string, {
      id: string; name: string; code: string; category: string; photo_url: string | null;
      totalTarget: number; totalActual: number; entries: number;
      avgEfficiency: number; bestDay: number; worstDay: number;
      daysWorked: Set<string>;
    }>();

    filtered.forEach((e: any) => {
      const emp = e.labour_employees;
      if (!emp) return;
      if (!map.has(e.employee_id)) {
        map.set(e.employee_id, {
          id: e.employee_id, name: emp.full_name, code: emp.employee_code,
          category: emp.category || "—", photo_url: emp.photo_url || null,
          totalTarget: 0, totalActual: 0,
          entries: 0, avgEfficiency: 0, bestDay: 0, worstDay: Infinity,
          daysWorked: new Set(),
        });
      }
      const s = map.get(e.employee_id)!;
      s.totalTarget += e.target_quantity || 0;
      s.totalActual += e.actual_quantity || 0;
      s.entries += 1;
      const eff = e.efficiency_percentage || 0;
      if (eff > s.bestDay) s.bestDay = eff;
      if (eff < s.worstDay) s.worstDay = eff;
      s.daysWorked.add(e.target_date);
    });

    return Array.from(map.values()).map(s => ({
      ...s,
      avgEfficiency: s.entries > 0 ? Math.round((s.totalActual / s.totalTarget) * 100) || 0 : 0,
      daysWorked: s.daysWorked.size,
      worstDay: s.worstDay === Infinity ? 0 : s.worstDay,
    })).sort((a, b) => b.avgEfficiency - a.avgEfficiency);
  }, [filtered]);

  // Daily trend for selected employee (or all)
  const dailyTrend = useMemo(() => {
    const dayMap = new Map<string, { target: number; actual: number; count: number }>();
    filtered.forEach((e: any) => {
      const d = e.target_date;
      if (!dayMap.has(d)) dayMap.set(d, { target: 0, actual: 0, count: 0 });
      const s = dayMap.get(d)!;
      s.target += e.target_quantity || 0;
      s.actual += e.actual_quantity || 0;
      s.count += 1;
    });

    // Generate all dates in the selected range
    const rangeStart = parseISO(dateRange.start);
    const rangeEnd = parseISO(dateRange.end);
    const allDays = eachDayOfInterval({ start: rangeStart, end: rangeEnd });

    return allDays.map(day => {
      const key = format(day, "yyyy-MM-dd");
      const v = dayMap.get(key);
      return {
        date: format(day, "dd MMM"),
        efficiency: v && v.target > 0 ? Math.round((v.actual / v.target) * 100) : null,
        actual: v?.actual || 0,
        target: v?.target || 0,
      };
    });
  }, [filtered, dateRange.start, dateRange.end]);

  // Top 10 and bottom 10
  const top10 = employeeSummary.slice(0, 10);
  const bottom10 = [...employeeSummary].sort((a, b) => a.avgEfficiency - b.avgEfficiency).slice(0, 10);

  // Overall metrics
  const totalEntries = filtered.length;
  const totalWorkers = employeeSummary.length;
  const avgEfficiency = totalEntries > 0
    ? Math.round(filtered.reduce((s: number, e: any) => s + (e.efficiency_percentage || 0), 0) / totalEntries)
    : 0;
  const belowTarget = employeeSummary.filter(e => e.avgEfficiency < 80).length;

  // Generate months for selector
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i);
    return { value: format(d, "yyyy-MM"), label: format(d, "MMM yyyy") };
  });

  const getEffBadge = (eff: number) => {
    if (eff >= 100) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{eff}%</Badge>;
    if (eff >= 80) return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30">{eff}%</Badge>;
    return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">{eff}%</Badge>;
  };

  const filteredEmployees = selectedDepartment === "all"
    ? employees
    : employees.filter((e: any) => e.department_id === selectedDepartment);

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader title="Individual Performance Analysis" description="Analyze worker-level productivity across periods" />

        {/* Period & Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Period</label>
                <Tabs value={periodMode} onValueChange={(v) => setPeriodMode(v as any)}>
                  <TabsList className="h-9">
                    <TabsTrigger value="daily" className="text-xs">Daily</TabsTrigger>
                    <TabsTrigger value="monthly" className="text-xs">Monthly</TabsTrigger>
                    <TabsTrigger value="custom" className="text-xs">Custom</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {periodMode === "daily" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1">
                      <CalendarIcon className="h-3.5 w-3.5" />
                      {format(selectedDate, "dd MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={selectedDate} onSelect={(d) => d && setSelectedDate(d)} className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              )}

              {periodMode === "monthly" && (
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {monthOptions.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {periodMode === "custom" && (
                <div className="flex gap-2">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {customFrom ? format(customFrom, "dd MMM") : "From"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customFrom} onSelect={setCustomFrom} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-1">
                        <CalendarIcon className="h-3.5 w-3.5" />
                        {customTo ? format(customTo, "dd MMM") : "To"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={customTo} onSelect={setCustomTo} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              <Select value={selectedDepartment} onValueChange={(v) => { setSelectedDepartment(v); setSelectedEmployee("all"); }}>
                <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Department" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Employee" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Workers</SelectItem>
                  {filteredEmployees.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                  className="pl-7 h-9 w-[150px]" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard title="Total Workers" value={totalWorkers} icon={User} />
          <MetricCard title="Avg Efficiency" value={`${avgEfficiency}%`} icon={TrendingUp}
            trend={{ value: avgEfficiency, isPositive: avgEfficiency >= 80 }} />
          <MetricCard title="Total Entries" value={totalEntries} icon={Target} />
          <MetricCard title="Below 80%" value={belowTarget} icon={Award}
            trend={{ value: belowTarget, isPositive: belowTarget === 0 }} />
        </div>

        {/* Efficiency Trend Chart */}
        {dailyTrend.length > 1 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Efficiency Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 'auto']} />
                    <Tooltip />
                    <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "Target 80%", fontSize: 10 }} />
                    <ReferenceLine y={100} stroke="#10b981" strokeDasharray="4 4" label={{ value: "100%", fontSize: 10 }} />
                    <Line type="monotone" dataKey="efficiency" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} name="Efficiency %" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top & Bottom Performers */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-emerald-400">🏆 Top 10 Performers</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[320px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">#</TableHead>
                      <TableHead className="text-xs">Worker</TableHead>
                      <TableHead className="text-xs text-right">Efficiency</TableHead>
                      <TableHead className="text-xs text-right hidden md:table-cell">Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {top10.map((e, i) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs font-medium">{i + 1}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-2">
                            <EmployeeAvatar name={e.name} photoUrl={e.photo_url} className="h-6 w-6" />
                            <div>
                              <div>{e.name}</div>
                              <div className="text-muted-foreground text-[10px]">{e.code}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{getEffBadge(e.avgEfficiency)}</TableCell>
                        <TableCell className="text-xs text-right hidden md:table-cell">{e.daysWorked}</TableCell>
                      </TableRow>
                    ))}
                    {top10.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-red-400">⚠️ Bottom 10 Performers</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[320px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">#</TableHead>
                      <TableHead className="text-xs">Worker</TableHead>
                      <TableHead className="text-xs text-right">Efficiency</TableHead>
                      <TableHead className="text-xs text-right hidden md:table-cell">Days</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bottom10.map((e, i) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs font-medium">{i + 1}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-2">
                            <EmployeeAvatar name={e.name} photoUrl={e.photo_url} className="h-6 w-6" />
                            <div>
                              <div>{e.name}</div>
                              <div className="text-muted-foreground text-[10px]">{e.code}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{getEffBadge(e.avgEfficiency)}</TableCell>
                        <TableCell className="text-xs text-right hidden md:table-cell">{e.daysWorked}</TableCell>
                      </TableRow>
                    ))}
                    {bottom10.length === 0 && (
                      <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-6">No data</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Top Performers Bar Chart */}
        {employeeSummary.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-primary" />
                Worker Efficiency Comparison
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={employeeSummary.slice(0, 20)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => [`${v}%`, "Efficiency"]} />
                    <ReferenceLine x={80} stroke="#f59e0b" strokeDasharray="4 4" />
                    <Bar dataKey="avgEfficiency" name="Efficiency %" radius={[0, 4, 4, 0]}
                      fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Full Employee Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Detailed Worker Performance ({dateRange.start} → {dateRange.end})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Worker</TableHead>
                    <TableHead className="text-xs hidden md:table-cell">Category</TableHead>
                    <TableHead className="text-xs text-right">Days</TableHead>
                    <TableHead className="text-xs text-right">Target</TableHead>
                    <TableHead className="text-xs text-right">Actual</TableHead>
                    <TableHead className="text-xs text-right">Avg Eff.</TableHead>
                    <TableHead className="text-xs text-right hidden md:table-cell">Best</TableHead>
                    <TableHead className="text-xs text-right hidden md:table-cell">Worst</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeSummary.map(e => (
                    <TableRow key={e.id} className={e.avgEfficiency < 80 ? "bg-red-500/5" : ""}>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-2">
                          <EmployeeAvatar name={e.name} photoUrl={e.photo_url} className="h-7 w-7" />
                          <div>
                            <div className="font-medium">{e.name}</div>
                            <div className="text-muted-foreground text-[10px]">{e.code}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs hidden md:table-cell">{e.category}</TableCell>
                      <TableCell className="text-xs text-right">{e.daysWorked}</TableCell>
                      <TableCell className="text-xs text-right">{e.totalTarget.toLocaleString()}</TableCell>
                      <TableCell className="text-xs text-right font-medium">{e.totalActual.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{getEffBadge(e.avgEfficiency)}</TableCell>
                      <TableCell className="text-xs text-right hidden md:table-cell text-emerald-400">{e.bestDay}%</TableCell>
                      <TableCell className="text-xs text-right hidden md:table-cell text-red-400">{e.worstDay}%</TableCell>
                    </TableRow>
                  ))}
                  {employeeSummary.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                        {isLoading ? "Loading..." : "No performance data for selected period"}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
};

export default IndividualPerformanceDashboard;
