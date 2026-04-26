import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, BarChart, Bar,
} from "recharts";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getDaysInMonth(month: number, year: number) {
  return new Date(year, month, 0).getDate();
}

const COLORS = ["#8b5cf6", "#06b6d4", "#f59e0b", "#ef4444", "#22c55e", "#ec4899", "#6366f1", "#14b8a6"];

export default function DailyProgressAnalysisPage() {
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(String(now.getMonth() + 1));
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");

  const month = parseInt(selectedMonth);
  const year = parseInt(selectedYear);
  const daysInMonth = getDaysInMonth(month, year);
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, employee_code, full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch all daily tracking entries for the month
  const { data: dailyEntries = [] } = useQuery({
    queryKey: ["daily-progress-entries", selectedMonth, selectedYear, selectedEmployee],
    queryFn: async () => {
      let q = supabase
        .from("performance_daily_tracking")
        .select("*, performance_monthly_kpis(id, code, name), employees(id, employee_code, full_name)")
        .gte("tracking_date", startDate)
        .lte("tracking_date", endDate);
      if (selectedEmployee !== "all") q = q.eq("employee_id", selectedEmployee);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  // Fetch goals for target comparison
  const { data: goals = [] } = useQuery({
    queryKey: ["daily-progress-goals", selectedMonth, selectedYear, selectedEmployee],
    queryFn: async () => {
      let q = supabase
        .from("performance_monthly_goals")
        .select("*, performance_monthly_kpis(id, code, name), employees(id, employee_code, full_name)")
        .eq("goal_month", month)
        .eq("goal_year", year);
      if (selectedEmployee !== "all") q = q.eq("employee_id", selectedEmployee);
      const { data, error } = await q;
      if (error) throw error;
      return data;
    },
  });

  // Analytics computations
  const analytics = useMemo(() => {
    if (!dailyEntries.length) return null;

    // Group by KPI
    const byKpi: Record<string, { kpiName: string; kpiCode: string; values: { day: number; value: number }[] }> = {};
    dailyEntries.forEach((e: any) => {
      const kpi = e.performance_monthly_kpis;
      if (!kpi || e.actual_value == null) return;
      if (!byKpi[kpi.id]) byKpi[kpi.id] = { kpiName: kpi.name, kpiCode: kpi.code, values: [] };
      byKpi[kpi.id].values.push({ day: new Date(e.tracking_date).getDate(), value: Number(e.actual_value) });
    });

    // KPI summaries
    const kpiSummaries = Object.entries(byKpi).map(([kpiId, data]) => {
      const sorted = [...data.values].sort((a, b) => a.day - b.day);
      const vals = sorted.map((v) => v.value);
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const goal = goals.find((g: any) => g.performance_monthly_kpis?.id === kpiId);
      const target = goal?.target_value ? Number(goal.target_value) : null;
      const achievementPct = target ? (avg / target) * 100 : null;
      // Trend: compare last 3 days avg vs first 3 days avg
      const first3 = vals.slice(0, Math.min(3, vals.length));
      const last3 = vals.slice(-Math.min(3, vals.length));
      const first3Avg = first3.reduce((a, b) => a + b, 0) / first3.length;
      const last3Avg = last3.reduce((a, b) => a + b, 0) / last3.length;
      const trendPct = first3Avg > 0 ? ((last3Avg - first3Avg) / first3Avg) * 100 : 0;

      return {
        kpiId, kpiName: data.kpiName, kpiCode: data.kpiCode,
        avg: Math.round(avg * 100) / 100, min, max, count: vals.length,
        target, achievementPct: achievementPct ? Math.round(achievementPct * 10) / 10 : null,
        trendPct: Math.round(trendPct * 10) / 10,
        dailyData: sorted,
      };
    });

    // Daily trend chart data (all KPIs)
    const trendData: Record<number, any> = {};
    for (let d = 1; d <= daysInMonth; d++) trendData[d] = { day: d };
    kpiSummaries.forEach((s) => {
      s.dailyData.forEach((v) => {
        trendData[v.day][s.kpiCode] = v.value;
      });
    });

    // Employee comparison (if viewing all)
    const byEmployee: Record<string, { name: string; code: string; totalEntries: number; avgScore: number }> = {};
    if (selectedEmployee === "all") {
      dailyEntries.forEach((e: any) => {
        const emp = e.employees;
        if (!emp || e.actual_value == null) return;
        if (!byEmployee[emp.id]) byEmployee[emp.id] = { name: emp.full_name, code: emp.employee_code, totalEntries: 0, avgScore: 0 };
        byEmployee[emp.id].totalEntries++;
        byEmployee[emp.id].avgScore += Number(e.actual_value);
      });
      Object.values(byEmployee).forEach((e) => {
        e.avgScore = e.totalEntries > 0 ? Math.round((e.avgScore / e.totalEntries) * 100) / 100 : 0;
      });
    }

    // Filling rate
    const uniqueKpis = Object.keys(byKpi).length;
    const uniqueEmployees = new Set(dailyEntries.map((e: any) => e.employee_id)).size;
    const today = now.getMonth() + 1 === month && now.getFullYear() === year ? now.getDate() : daysInMonth;
    const expectedEntries = uniqueKpis * uniqueEmployees * today;
    const fillingRate = expectedEntries > 0 ? Math.round((dailyEntries.length / expectedEntries) * 100) : 0;

    return {
      kpiSummaries,
      trendData: Object.values(trendData),
      employeeComparison: Object.values(byEmployee).sort((a, b) => b.avgScore - a.avgScore),
      totalEntries: dailyEntries.length,
      fillingRate,
      uniqueEmployees,
    };
  }, [dailyEntries, goals, daysInMonth, selectedEmployee, month, year]);

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader
          title="Daily Progress Analysis"
          description="Analyze daily KPI tracking trends and performance"
          icon={BarChart3}
          iconColor="bg-cyan-100 text-cyan-700"
        />

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div className="space-y-1">
                <label className="text-sm font-medium">Month</label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Year</label>
                <Select value={selectedYear} onValueChange={setSelectedYear}>
                  <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{[2024, 2025, 2026].map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Employee</label>
                <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                  <SelectTrigger className="w-[250px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Employees</SelectItem>
                    {employees.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.employee_code} - {e.full_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {analytics ? (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground">Total Entries</p>
                  <p className="text-2xl font-bold">{analytics.totalEntries}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground">KPIs Tracked</p>
                  <p className="text-2xl font-bold">{analytics.kpiSummaries.length}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground">Employees</p>
                  <p className="text-2xl font-bold">{analytics.uniqueEmployees}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-4 text-center">
                  <p className="text-xs text-muted-foreground">Filling Rate</p>
                  <p className="text-2xl font-bold">{analytics.fillingRate}%</p>
                </CardContent>
              </Card>
            </div>

            {/* Daily Trend Chart */}
            {analytics.kpiSummaries.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Daily KPI Trends</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={analytics.trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Legend />
                      {analytics.kpiSummaries.map((s, i) => (
                        <Line key={s.kpiId} type="monotone" dataKey={s.kpiCode} name={s.kpiName} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} connectNulls />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}

            {/* KPI Summary Table */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">KPI Performance Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        <th className="px-3 py-2 text-left">KPI</th>
                        <th className="px-3 py-2 text-center">Target</th>
                        <th className="px-3 py-2 text-center">Avg</th>
                        <th className="px-3 py-2 text-center">Min</th>
                        <th className="px-3 py-2 text-center">Max</th>
                        <th className="px-3 py-2 text-center">Days</th>
                        <th className="px-3 py-2 text-center">Achievement</th>
                        <th className="px-3 py-2 text-center">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analytics.kpiSummaries.map((s) => (
                        <tr key={s.kpiId} className="border-b hover:bg-muted/30">
                          <td className="px-3 py-2">
                            <span className="font-medium">{s.kpiCode}</span>
                            <span className="text-muted-foreground ml-1">— {s.kpiName}</span>
                          </td>
                          <td className="px-3 py-2 text-center">{s.target ?? "-"}</td>
                          <td className="px-3 py-2 text-center font-semibold">{s.avg}</td>
                          <td className="px-3 py-2 text-center">{s.min}</td>
                          <td className="px-3 py-2 text-center">{s.max}</td>
                          <td className="px-3 py-2 text-center">{s.count}</td>
                          <td className="px-3 py-2 text-center">
                            {s.achievementPct !== null ? (
                              <Badge variant={s.achievementPct >= 100 ? "default" : s.achievementPct >= 80 ? "secondary" : "destructive"}>
                                {s.achievementPct}%
                              </Badge>
                            ) : "-"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`inline-flex items-center gap-1 text-xs font-medium ${s.trendPct > 0 ? "text-green-600" : s.trendPct < 0 ? "text-red-600" : "text-muted-foreground"}`}>
                              {s.trendPct > 0 ? <TrendingUp className="h-3 w-3" /> : s.trendPct < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
                              {s.trendPct > 0 ? "+" : ""}{s.trendPct}%
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            {/* Employee Comparison (all employees mode) */}
            {selectedEmployee === "all" && analytics.employeeComparison.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Employee Comparison</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={Math.max(200, analytics.employeeComparison.length * 36)}>
                    <BarChart data={analytics.employeeComparison} layout="vertical" margin={{ left: 120 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis type="number" tick={{ fontSize: 11 }} />
                      <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={110} />
                      <Tooltip />
                      <Bar dataKey="avgScore" name="Avg Score" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No daily tracking data found for {MONTHS[month - 1]} {year}. Start recording daily KPI values first.
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
