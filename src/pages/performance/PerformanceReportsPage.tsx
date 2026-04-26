import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { TrendingUp, Award, BarChart3, Calendar } from "lucide-react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];


const getScoreColor = (pct: number) => {
  if (pct >= 90) return "text-green-600";
  if (pct >= 70) return "text-blue-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
};

const getScoreBadge = (pct: number): "default" | "secondary" | "destructive" => {
  if (pct >= 80) return "default";
  if (pct >= 50) return "secondary";
  return "destructive";
};

export default function PerformanceReportsPage() {
  const now = new Date();
  const [selectedYear, setSelectedYear] = useState(String(now.getFullYear()));
  const [selectedEmployee, setSelectedEmployee] = useState<string>("all");
  const [viewMode, setViewMode] = useState("monthly");

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  const { data: employees = [] } = useQuery({
    queryKey: ["employees-active-reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("employees").select("id, employee_code, full_name").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
  });

  const { data: kpis = [] } = useQuery({
    queryKey: ["monthly-kpis-reports"],
    queryFn: async () => {
      const { data, error } = await supabase.from("performance_monthly_kpis").select("*").eq("is_active", true).order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: allScores = [] } = useQuery({
    queryKey: ["monthly-goals-report", selectedYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_monthly_goals")
        .select("*, employees(employee_code, full_name), performance_monthly_kpis(code, name, weight, max_score)")
        .eq("goal_year", parseInt(selectedYear))
        .in("status", ["approved", "closed"]);
      if (error) throw error;
      return data as any[];
    },
  });

  // Process data: compute monthly averages per employee
  const processedData = useMemo(() => {
    const empFilter = selectedEmployee === "all" ? employees : employees.filter((e) => e.id === selectedEmployee);
    const _totalWeight = kpis.reduce((sum, k) => sum + (k.weight || 1), 0);

    return empFilter.map((emp) => {
      const empScores = allScores.filter((s) => s.employee_id === emp.id);
      const monthlyData: { month: number; monthName: string; totalScore: number; maxWeight: number; percentage: number }[] = [];

      for (let m = 1; m <= 12; m++) {
        const monthScores = empScores.filter((s) => s.goal_month === m);
        const totalScore = monthScores.reduce((sum, s) => sum + (s.score || 0), 0);
        const monthMaxWeight = monthScores.reduce((sum, s) => sum + (s.performance_monthly_kpis?.weight || 0), 0);
        const pct = monthMaxWeight > 0 ? Math.round((totalScore / monthMaxWeight) * 100) : 0;
        monthlyData.push({ month: m, monthName: MONTHS[m - 1], totalScore: Math.round(totalScore * 100) / 100, maxWeight: monthMaxWeight, percentage: pct });
      }

      // Quarterly
      const quarterlyData = [
        { label: "Q1", months: [1, 2, 3] },
        { label: "Q2", months: [4, 5, 6] },
        { label: "Q3", months: [7, 8, 9] },
        { label: "Q4", months: [10, 11, 12] },
      ].map((q) => {
        const qMonths = monthlyData.filter((md) => q.months.includes(md.month) && md.totalScore > 0);
        const avg = qMonths.length > 0 ? Math.round(qMonths.reduce((s, m) => s + m.percentage, 0) / qMonths.length) : 0;
        return { label: q.label, percentage: avg, monthCount: qMonths.length };
      });

      // Yearly
      const scoredMonths = monthlyData.filter((md) => md.totalScore > 0);
      const yearlyAvg = scoredMonths.length > 0
        ? Math.round(scoredMonths.reduce((s, m) => s + m.percentage, 0) / scoredMonths.length)
        : 0;

      return {
        employee_id: emp.id,
        employee_code: emp.employee_code,
        full_name: emp.full_name,
        monthlyData,
        quarterlyData,
        yearlyAvg,
      };
    }).sort((a, b) => b.yearlyAvg - a.yearlyAvg);
  }, [allScores, employees, kpis, selectedEmployee]);

  // Chart data for trend
  const trendChartData = useMemo(() => {
    return MONTHS.map((name, i) => {
      const entry: any = { month: name };
      processedData.slice(0, 5).forEach((emp) => {
        entry[emp.full_name] = emp.monthlyData[i].percentage;
      });
      return entry;
    });
  }, [processedData]);

  const chartColors = ["hsl(var(--primary))", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Performance Reports"
          description="Monthly, quarterly, and yearly performance analysis with trends"
        />

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div>
            <Label className="text-xs">Year</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear}>
              <SelectTrigger className="w-[100px]"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Employee</Label>
            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
              <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Employees</SelectItem>
                {employees.map((emp) => (
                  <SelectItem key={emp.id} value={emp.id}>{emp.employee_code} - {emp.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-lg"><Award className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">Employees Tracked</p>
                  <p className="text-2xl font-bold">{processedData.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/10 rounded-lg"><TrendingUp className="h-5 w-5 text-green-600" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">Avg Yearly Score</p>
                  <p className="text-2xl font-bold">
                    {processedData.length > 0 ? Math.round(processedData.reduce((s, e) => s + e.yearlyAvg, 0) / processedData.length) : 0}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/10 rounded-lg"><BarChart3 className="h-5 w-5 text-blue-600" /></div>
                <div>
                  <p className="text-sm text-muted-foreground">Top Performer</p>
                  <p className="text-lg font-bold truncate">{processedData[0]?.full_name || "N/A"}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs value={viewMode} onValueChange={setViewMode}>
          <TabsList>
            <TabsTrigger value="monthly"><Calendar className="h-4 w-4 mr-1" /> Monthly</TabsTrigger>
            <TabsTrigger value="quarterly"><BarChart3 className="h-4 w-4 mr-1" /> Quarterly</TabsTrigger>
            <TabsTrigger value="yearly"><TrendingUp className="h-4 w-4 mr-1" /> Yearly</TabsTrigger>
            <TabsTrigger value="trend">Trend Chart</TabsTrigger>
          </TabsList>

          {/* Monthly View */}
          <TabsContent value="monthly">
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10">Employee</TableHead>
                        {MONTHS.map((m) => <TableHead key={m} className="text-center min-w-[60px]">{m}</TableHead>)}
                        <TableHead className="text-center">Avg</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processedData.map((emp) => (
                        <TableRow key={emp.employee_id}>
                          <TableCell className="sticky left-0 bg-background z-10 font-medium">{emp.full_name}</TableCell>
                          {emp.monthlyData.map((md) => (
                            <TableCell key={md.month} className="text-center">
                              {md.totalScore > 0 ? (
                                <span className={`font-medium ${getScoreColor(md.percentage)}`}>{md.percentage}%</span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                          ))}
                          <TableCell className="text-center">
                            <Badge variant={getScoreBadge(emp.yearlyAvg)}>{emp.yearlyAvg}%</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Quarterly View */}
          <TabsContent value="quarterly">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {processedData.map((emp) => (
                <Card key={emp.employee_id}>
                  <CardHeader className="pb-3 bg-muted/30">
                    <CardTitle className="text-base">{emp.full_name}</CardTitle>
                    <p className="text-xs text-muted-foreground">{emp.employee_code}</p>
                  </CardHeader>
                  <CardContent className="pt-4 space-y-3">
                    {emp.quarterlyData.map((q) => (
                      <div key={q.label}>
                        <div className="flex justify-between text-sm mb-1">
                          <span>{q.label}</span>
                          <span className={`font-medium ${getScoreColor(q.percentage)}`}>
                            {q.monthCount > 0 ? `${q.percentage}%` : "-"}
                          </span>
                        </div>
                        <Progress value={q.percentage} className="h-2" />
                      </div>
                    ))}
                    <div className="pt-2 border-t flex justify-between">
                      <span className="text-sm font-medium">Yearly Average</span>
                      <Badge variant={getScoreBadge(emp.yearlyAvg)}>{emp.yearlyAvg}%</Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Yearly View */}
          <TabsContent value="yearly">
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rank</TableHead>
                      <TableHead>Employee</TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Q1</TableHead>
                      <TableHead>Q2</TableHead>
                      <TableHead>Q3</TableHead>
                      <TableHead>Q4</TableHead>
                      <TableHead>Yearly Avg</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processedData.map((emp, idx) => (
                      <TableRow key={emp.employee_id}>
                        <TableCell className="font-bold">{idx + 1}</TableCell>
                        <TableCell className="font-medium">{emp.full_name}</TableCell>
                        <TableCell>{emp.employee_code}</TableCell>
                        {emp.quarterlyData.map((q) => (
                          <TableCell key={q.label}>
                            <span className={getScoreColor(q.percentage)}>{q.monthCount > 0 ? `${q.percentage}%` : "-"}</span>
                          </TableCell>
                        ))}
                        <TableCell>
                          <Badge variant={getScoreBadge(emp.yearlyAvg)} className="text-base px-3">{emp.yearlyAvg}%</Badge>
                        </TableCell>
                        <TableCell>
                          {emp.yearlyAvg >= 90 ? "⭐ Excellent" : emp.yearlyAvg >= 70 ? "✅ Good" : emp.yearlyAvg >= 50 ? "⚠️ Average" : emp.yearlyAvg > 0 ? "❌ Needs Improvement" : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trend Chart */}
          <TabsContent value="trend">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Performance Trend - {selectedYear}</CardTitle>
              </CardHeader>
              <CardContent>
                {processedData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={400}>
                    <LineChart data={trendChartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis domain={[0, 100]} />
                      <Tooltip />
                      <Legend />
                      {processedData.slice(0, 5).map((emp, i) => (
                        <Line
                          key={emp.employee_id}
                          type="monotone"
                          dataKey={emp.full_name}
                          stroke={chartColors[i]}
                          strokeWidth={2}
                          dot={{ r: 4 }}
                          connectNulls
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-center text-muted-foreground py-12">No data available</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </ERPLayout>
  );
}
