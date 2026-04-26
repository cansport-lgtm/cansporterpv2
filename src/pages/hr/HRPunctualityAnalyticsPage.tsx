import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, BarChart, Bar, Cell } from "recharts";
import { Clock, TrendingDown, Users, Building2, AlertTriangle, Search } from "lucide-react";
import { format, startOfMonth, endOfMonth, getDaysInMonth, getDay, subMonths } from "date-fns";

const LATE_THRESHOLD_TIME = "09:15";

const months = Array.from({ length: 12 }, (_, i) => ({
  value: String(i + 1),
  label: format(new Date(2024, i), "MMMM"),
}));

const currentYear = new Date().getFullYear();
const years = Array.from({ length: 5 }, (_, i) => ({
  value: String(currentYear - i),
  label: String(currentYear - i),
}));

const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HRPunctualityAnalyticsPage() {
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(currentYear));
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const monthNum = parseInt(selectedMonth);
  const yearNum = parseInt(selectedYear);
  const monthStart = format(startOfMonth(new Date(yearNum, monthNum - 1)), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(new Date(yearNum, monthNum - 1)), "yyyy-MM-dd");

  const { data: departments } = useQuery({
    queryKey: ["departments-punctuality"],
    queryFn: async () => {
      const { data } = await supabase.from("production_departments").select("id, name").eq("is_active", true);
      return data || [];
    },
  });

  const { data: attendanceData, isLoading } = useQuery({
    queryKey: ["punctuality-analytics", selectedMonth, selectedYear, departmentFilter],
    queryFn: async () => {
      let query = supabase
        .from("attendance")
        .select("*, employees!inner(full_name, employee_code, department_id, production_departments:department_id(name))")
        .gte("attendance_date", monthStart)
        .lte("attendance_date", monthEnd);

      if (departmentFilter !== "all") {
        query = query.eq("employees.department_id", departmentFilter);
      }

      const { data } = await query;
      return data || [];
    },
  });

  // Fetch last 6 months for comparison
  const { data: historicalData } = useQuery({
    queryKey: ["punctuality-historical", selectedYear, selectedMonth],
    queryFn: async () => {
      const results = [];
      for (let i = 5; i >= 0; i--) {
        const d = subMonths(new Date(yearNum, monthNum - 1), i);
        const ms = format(startOfMonth(d), "yyyy-MM-dd");
        const me = format(endOfMonth(d), "yyyy-MM-dd");
        const { count } = await supabase
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .gte("attendance_date", ms)
          .lte("attendance_date", me)
          .eq("status", "L");
        results.push({ month: format(d, "MMM yy"), lateCount: count || 0 });
      }
      return results;
    },
  });

  const analytics = useMemo(() => {
    if (!attendanceData?.length) return null;

    const isLate = (record: any) => record.status === "L" || (record.check_in && record.check_in > LATE_THRESHOLD_TIME);

    const totalEntries = attendanceData.filter((r) => ["P", "L", "H"].includes(r.status)).length;
    const lateEntries = attendanceData.filter(isLate);
    const lateCount = lateEntries.length;
    const latePercentage = totalEntries > 0 ? ((lateCount / totalEntries) * 100).toFixed(1) : "0";

    // Average check-in
    const checkIns = attendanceData.filter((r) => r.check_in).map((r) => r.check_in as string);
    let avgCheckIn = "--:--";
    if (checkIns.length > 0) {
      const totalMinutes = checkIns.reduce((sum, t) => {
        const [h, m] = t.split(":").map(Number);
        return sum + h * 60 + (m || 0);
      }, 0);
      const avg = Math.round(totalMinutes / checkIns.length);
      avgCheckIn = `${String(Math.floor(avg / 60)).padStart(2, "0")}:${String(avg % 60).padStart(2, "0")}`;
    }

    // Department stats
    const deptMap: Record<string, { name: string; total: number; late: number }> = {};
    attendanceData.forEach((r: any) => {
      const deptName = r.employees?.production_departments?.name || "Unknown";
      const deptId = r.employees?.department_id || "unknown";
      if (!deptMap[deptId]) deptMap[deptId] = { name: deptName, total: 0, late: 0 };
      if (["P", "L", "H"].includes(r.status)) deptMap[deptId].total++;
      if (isLate(r)) deptMap[deptId].late++;
    });

    const deptStats = Object.values(deptMap).filter((d) => d.total > 0);
    const mostPunctual = deptStats.length ? deptStats.reduce((a, b) => (a.late / a.total < b.late / b.total ? a : b)).name : "N/A";
    const highestLate = deptStats.length ? deptStats.reduce((a, b) => (a.late / a.total > b.late / b.total ? a : b)).name : "N/A";

    // Daily trend
    const dailyMap: Record<string, number> = {};
    const daysInMonth = getDaysInMonth(new Date(yearNum, monthNum - 1));
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = format(new Date(yearNum, monthNum - 1, d), "yyyy-MM-dd");
      dailyMap[dateStr] = 0;
    }
    lateEntries.forEach((r) => {
      if (dailyMap[r.attendance_date] !== undefined) dailyMap[r.attendance_date]++;
    });
    const dailyTrend = Object.entries(dailyMap).map(([date, count]) => ({
      date: format(new Date(date), "dd"),
      lateCount: count,
    }));

    // Day-of-week analysis
    const dowMap: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    lateEntries.forEach((r) => {
      const dow = getDay(new Date(r.attendance_date));
      if (dow >= 1 && dow <= 6) dowMap[dow]++;
    });
    const dayOfWeekData = Object.entries(dowMap).map(([dow, count]) => ({
      day: dayNames[parseInt(dow)],
      lateCount: count,
    }));

    // Department bar chart
    const deptBarData = deptStats.map((d) => ({
      name: d.name,
      lateCount: d.late,
      latePercent: ((d.late / d.total) * 100).toFixed(1),
    }));

    // Employee table
    const empMap: Record<string, { name: string; code: string; dept: string; total: number; present: number; late: number; absent: number; halfDay: number; checkIns: string[] }> = {};
    attendanceData.forEach((r: any) => {
      const empId = r.employee_id;
      if (!empMap[empId]) {
        empMap[empId] = {
          name: r.employees?.full_name || "Unknown",
          code: r.employees?.employee_code || "",
          dept: r.employees?.production_departments?.name || "Unknown",
          total: 0, present: 0, late: 0, absent: 0, halfDay: 0, checkIns: [],
        };
      }
      const e = empMap[empId];
      if (["P", "L", "H", "A"].includes(r.status)) e.total++;
      if (r.status === "P") e.present++;
      if (r.status === "A") e.absent++;
      if (r.status === "H") e.halfDay++;
      if (isLate(r)) e.late++;
      if (r.check_in) e.checkIns.push(r.check_in);
    });

    const employeeTable = Object.values(empMap)
      .map((e) => {
        let avgCI = "--:--";
        if (e.checkIns.length) {
          const totalMin = e.checkIns.reduce((s, t) => {
            const [h, m] = t.split(":").map(Number);
            return s + h * 60 + (m || 0);
          }, 0);
          const a = Math.round(totalMin / e.checkIns.length);
          avgCI = `${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
        }
        const workDays = e.present + e.late + e.halfDay;
        return {
          ...e,
          latePercent: workDays > 0 ? ((e.late / workDays) * 100).toFixed(1) : "0",
          avgCheckIn: avgCI,
          isChronic: e.late > 3,
        };
      })
      .filter((e) => !searchQuery || e.name.toLowerCase().includes(searchQuery.toLowerCase()) || e.code.toLowerCase().includes(searchQuery.toLowerCase()))
      .sort((a, b) => b.late - a.late);

    return { lateCount, latePercentage, avgCheckIn, mostPunctual, highestLate, dailyTrend, dayOfWeekData, deptBarData, employeeTable };
  }, [attendanceData, searchQuery, yearNum, monthNum]);

  const chartConfig = {
    lateCount: { label: "Late Count", color: "hsl(var(--destructive))" },
  };

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader title="Punctuality Analytics" description="Staff late trends and attendance behavior analysis" />

        {/* Filters */}
        <div className="flex flex-wrap gap-2">
          <Select value={selectedMonth} onValueChange={setSelectedMonth}>
            <SelectTrigger className="w-[130px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={selectedYear} onValueChange={setSelectedYear}>
            <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y.value} value={y.value}>{y.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
            <SelectTrigger className="w-[160px]"><SelectValue placeholder="All Departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments?.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="text-center py-10 text-muted-foreground">Loading analytics...</div>
        ) : !analytics ? (
          <div className="text-center py-10 text-muted-foreground">No attendance data found for this period.</div>
        ) : (
          <>
            {/* Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricCard title="Late Arrivals" value={analytics.lateCount} icon={AlertTriangle} iconColor="text-destructive" />
              <MetricCard title="Late %" value={`${analytics.latePercentage}%`} icon={TrendingDown} iconColor="text-orange-500" />
              <MetricCard title="Avg Check-in" value={analytics.avgCheckIn} icon={Clock} iconColor="text-blue-500" />
              <MetricCard title="Most Punctual" value={analytics.mostPunctual} icon={Building2} iconColor="text-green-500" />
              <MetricCard title="Highest Late" value={analytics.highestLate} icon={Users} iconColor="text-destructive" />
            </div>

            {/* Daily Late Trend */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Daily Late Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={chartConfig} className="h-[200px] w-full">
                  <LineChart data={analytics.dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" fontSize={10} />
                    <YAxis allowDecimals={false} fontSize={10} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="lateCount" stroke="hsl(var(--destructive))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>

            {/* Department + Day-of-Week charts side by side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Department Late Count</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[200px] w-full">
                    <BarChart data={analytics.deptBarData} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" allowDecimals={false} fontSize={10} />
                      <YAxis dataKey="name" type="category" width={80} fontSize={10} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="lateCount" radius={[0, 4, 4, 0]}>
                        {analytics.deptBarData.map((entry, i) => {
                          const pct = parseFloat(entry.latePercent);
                          const color = pct < 5 ? "hsl(142 71% 45%)" : pct < 15 ? "hsl(38 92% 50%)" : "hsl(var(--destructive))";
                          return <Cell key={i} fill={color} />;
                        })}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">Day-of-Week Analysis</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[200px] w-full">
                    <BarChart data={analytics.dayOfWeekData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" fontSize={10} />
                      <YAxis allowDecimals={false} fontSize={10} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="lateCount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            {/* Monthly Comparison */}
            {historicalData && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">6-Month Late Trend</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChartContainer config={chartConfig} className="h-[180px] w-full">
                    <BarChart data={historicalData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" fontSize={10} />
                      <YAxis allowDecimals={false} fontSize={10} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="lateCount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            )}

            {/* Employee Punctuality Table */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium">Employee Punctuality</CardTitle>
                  <div className="relative w-full max-w-[200px]">
                    <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-8 h-8 text-xs" />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="text-left p-2 font-medium">Employee</th>
                        <th className="text-left p-2 font-medium hidden md:table-cell">Dept</th>
                        <th className="text-center p-2 font-medium">P</th>
                        <th className="text-center p-2 font-medium">L</th>
                        <th className="text-center p-2 font-medium">A</th>
                        <th className="text-center p-2 font-medium">L%</th>
                        <th className="text-center p-2 font-medium hidden sm:table-cell">Avg In</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.employeeTable.map((emp, i) => (
                        <tr key={i} className={`border-b ${emp.isChronic ? "bg-destructive/5" : ""}`}>
                          <td className="p-2">
                            <div className="flex items-center gap-1">
                              <span className="font-medium truncate max-w-[120px]">{emp.name}</span>
                              {emp.isChronic && <Badge variant="destructive" className="text-[9px] px-1 py-0">Chronic</Badge>}
                            </div>
                          </td>
                          <td className="p-2 text-muted-foreground hidden md:table-cell truncate max-w-[80px]">{emp.dept}</td>
                          <td className="text-center p-2">{emp.present}</td>
                          <td className="text-center p-2 font-medium text-destructive">{emp.late}</td>
                          <td className="text-center p-2">{emp.absent}</td>
                          <td className="text-center p-2">
                            <span className={parseFloat(emp.latePercent) > 15 ? "text-destructive font-medium" : parseFloat(emp.latePercent) > 5 ? "text-orange-500" : "text-green-600"}>
                              {emp.latePercent}%
                            </span>
                          </td>
                          <td className="text-center p-2 hidden sm:table-cell">{emp.avgCheckIn}</td>
                        </tr>
                      ))}
                      {analytics.employeeTable.length === 0 && (
                        <tr><td colSpan={7} className="text-center p-4 text-muted-foreground">No records found</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </ERPLayout>
  );
}
