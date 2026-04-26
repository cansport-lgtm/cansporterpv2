import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Target, Users, CheckCircle2, TrendingUp, Award, BarChart3,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from "recharts";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_CONFIG: Record<string, { label: string; color: string; badgeVariant: "default" | "secondary" | "destructive" | "outline" }> = {
  draft: { label: "Draft", color: "#94a3b8", badgeVariant: "secondary" },
  pending_review: { label: "Pending Review", color: "#f59e0b", badgeVariant: "outline" },
  approved: { label: "Approved", color: "#3b82f6", badgeVariant: "default" },
  closed: { label: "Closed", color: "#22c55e", badgeVariant: "destructive" },
};

export default function MonthlyPerformanceDashboard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  // Fetch all goals for the selected month
  const { data: goals = [] } = useQuery({
    queryKey: ["monthly-perf-dashboard-goals", month, year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_monthly_goals" as any)
        .select("*, employees(full_name, employee_code), performance_monthly_kpis(name, code, weight, max_score)")
        .eq("month", month)
        .eq("year", year);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch employees list for context
  const { data: employees = [] } = useQuery({
    queryKey: ["monthly-perf-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employees")
        .select("id, full_name, employee_code")
        .eq("is_active", true);
      if (error) throw error;
      return data || [];
    },
  });

  // Compute metrics
  const uniqueEmployees = new Set(goals.map((g: any) => g.employee_id));
  const totalGoals = goals.length;
  const statusCounts = goals.reduce((acc: Record<string, number>, g: any) => {
    acc[g.status] = (acc[g.status] || 0) + 1;
    return acc;
  }, {});

  const goalsWithScores = goals.filter((g: any) => g.actual_value != null && g.target_value > 0);
  const avgScore = goalsWithScores.length > 0
    ? Math.round(goalsWithScores.reduce((sum: number, g: any) => sum + ((g.actual_value / g.target_value) * 100), 0) / goalsWithScores.length)
    : 0;

  const closedCount = statusCounts["closed"] || 0;
  const approvedCount = statusCounts["approved"] || 0;

  // Status pie chart data
  const statusPieData = Object.entries(statusCounts).map(([status, count]) => ({
    name: STATUS_CONFIG[status]?.label || status,
    value: count,
    color: STATUS_CONFIG[status]?.color || "#94a3b8",
  }));

  // Employee scores for bar chart
  const employeeScoreMap: Record<string, { name: string; code: string; totalScore: number; maxScore: number; count: number }> = {};
  goals.forEach((g: any) => {
    const empId = g.employee_id;
    const empName = g.employees?.full_name || "Unknown";
    const empCode = g.employees?.employee_code || "";
    if (!employeeScoreMap[empId]) {
      employeeScoreMap[empId] = { name: empName, code: empCode, totalScore: 0, maxScore: 0, count: 0 };
    }
    const weight = g.performance_monthly_kpis?.weight || 0;
    const score = g.target_value > 0 ? Math.min((g.actual_value || 0) / g.target_value * weight, weight) : 0;
    employeeScoreMap[empId].totalScore += score;
    employeeScoreMap[empId].maxScore += weight;
    employeeScoreMap[empId].count += 1;
  });

  const employeeBarData = Object.values(employeeScoreMap)
    .map((e) => ({
      name: e.code || e.name.split(" ")[0],
      fullName: e.name,
      score: Math.round(e.maxScore > 0 ? (e.totalScore / e.maxScore) * 100 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  const getScoreColor = (pct: number) => {
    if (pct >= 90) return "#22c55e";
    if (pct >= 75) return "#3b82f6";
    if (pct >= 50) return "#f59e0b";
    return "#ef4444";
  };

  // Top performers table
  const topPerformers = Object.entries(employeeScoreMap)
    .map(([id, e]) => ({
      id,
      name: e.name,
      code: e.code,
      score: Math.round(e.maxScore > 0 ? (e.totalScore / e.maxScore) * 100 : 0),
      kpis: e.count,
      rating: e.maxScore > 0 && (e.totalScore / e.maxScore) * 100 >= 90 ? "Excellent"
        : e.maxScore > 0 && (e.totalScore / e.maxScore) * 100 >= 75 ? "Good"
        : e.maxScore > 0 && (e.totalScore / e.maxScore) * 100 >= 50 ? "Satisfactory"
        : "Needs Improvement",
    }))
    .sort((a, b) => b.score - a.score);

  const yearOptions = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Monthly Performance Dashboard"
          description={`Performance overview for ${MONTHS[month - 1]} ${year}`}
          icon={BarChart3}
        />

        {/* Month/Year Selector */}
        <div className="flex gap-3">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {yearOptions.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Employees Tracked"
            value={uniqueEmployees.size}
            icon={Users}
            description={`of ${employees.length} active employees`}
          />
          <MetricCard
            title="Total KPI Goals"
            value={totalGoals}
            icon={Target}
            description="Assigned this month"
          />
          <MetricCard
            title="Average Score"
            value={`${avgScore}%`}
            icon={TrendingUp}
            description={goalsWithScores.length > 0 ? `From ${goalsWithScores.length} scored goals` : "No scores yet"}
          />
          <MetricCard
            title="Completed"
            value={closedCount + approvedCount}
            icon={CheckCircle2}
            description={`${closedCount} closed, ${approvedCount} approved`}
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Goal Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Goal Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {statusPieData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusPieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={75}
                        dataKey="value"
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {statusPieData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No goals assigned for this month
                </div>
              )}
            </CardContent>
          </Card>

          {/* Employee Score Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employee Score Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              {employeeBarData.length > 0 ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={employeeBarData} layout="vertical">
                      <XAxis type="number" domain={[0, 100]} />
                      <YAxis dataKey="name" type="category" width={70} tick={{ fontSize: 12 }} />
                      <Tooltip
                        formatter={(value: number) => [`${value}%`, "Score"]}
                        labelFormatter={(label) => {
                          const emp = employeeBarData.find((e) => e.name === label);
                          return emp?.fullName || label;
                        }}
                      />
                      <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                        {employeeBarData.map((entry, i) => (
                          <Cell key={i} fill={getScoreColor(entry.score)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No score data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Employee Scorecard Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4" />
              Employee Scorecard — {MONTHS[month - 1]} {year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topPerformers.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>KPIs</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead className="w-[200px]">Progress</TableHead>
                    <TableHead>Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topPerformers.map((emp, idx) => (
                    <TableRow key={emp.id}>
                      <TableCell className="font-medium">{idx + 1}</TableCell>
                      <TableCell className="font-medium">{emp.name}</TableCell>
                      <TableCell className="text-muted-foreground">{emp.code}</TableCell>
                      <TableCell>{emp.kpis}</TableCell>
                      <TableCell className="font-bold" style={{ color: getScoreColor(emp.score) }}>
                        {emp.score}%
                      </TableCell>
                      <TableCell>
                        <Progress value={emp.score} className="h-2" />
                      </TableCell>
                      <TableCell>
                        <Badge variant={
                          emp.rating === "Excellent" ? "default" :
                          emp.rating === "Good" ? "secondary" :
                          emp.rating === "Satisfactory" ? "outline" : "destructive"
                        }>
                          {emp.rating}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="py-12 text-center text-muted-foreground">
                No goals assigned for {MONTHS[month - 1]} {year}. Go to Goal Assignment to get started.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
