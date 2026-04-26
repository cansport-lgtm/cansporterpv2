import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { Users, TrendingUp, Award, Building2, Clock, CalendarIcon, Sparkles, Loader2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, LineChart, Line } from "recharts";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import ReactMarkdown from "react-markdown";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

const LabourProductivityDashboard = () => {
  const [dateRange, setDateRange] = useState("today");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiInsights, setAiInsights] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDeptName, setAiDeptName] = useState("");
  const [aiEfficiency, setAiEfficiency] = useState(0);

  const getDateFilter = () => {
    const today = new Date();
    switch (dateRange) {
      case "today":
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "week":
        return { start: format(subDays(today, 7), "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      case "month":
        return { start: format(startOfMonth(today), "yyyy-MM-dd"), end: format(endOfMonth(today), "yyyy-MM-dd") };
      case "custom":
        if (customDate) {
          return { start: format(customDate, "yyyy-MM-dd"), end: format(customDate, "yyyy-MM-dd") };
        }
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
      default:
        return { start: format(today, "yyyy-MM-dd"), end: format(today, "yyyy-MM-dd") };
    }
  };

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: productivityData = [], isLoading } = useQuery({
    queryKey: ["labour-productivity", dateRange, selectedDepartment, customDate?.toISOString()],
    queryFn: async () => {
      const { start, end } = getDateFilter();
      let query = supabase
        .from("labour_productivity_targets")
        .select(`
          *,
          labour_employees(id, full_name, employee_code, category),
          production_departments(id, name, code),
          qa_processes(id, name, code),
          created_by_user:app_users!labour_productivity_targets_created_by_fkey(id, full_name)
        `)
        .gte("target_date", start)
        .lte("target_date", end);

      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }

      const { data, error } = await query.order("created_at", { ascending: false }).limit(5000);
      if (error) throw error;
      return data;
    },
  });

  // Calculate metrics
  const totalWorkers = new Set(productivityData.map((d) => d.employee_id)).size;
  const avgEfficiency = productivityData.length > 0
    ? productivityData.reduce((sum, d) => sum + Number(d.efficiency_percentage || 0), 0) / productivityData.length
    : 0;

  // Top performers
  const employeeStats = productivityData.reduce((acc, entry) => {
    const empId = entry.employee_id;
    if (!acc[empId]) {
      acc[empId] = {
        employee: (entry as any).labour_employees,
        department: entry.production_departments,
        totalTarget: 0,
        totalActual: 0,
        entries: 0,
      };
    }
    acc[empId].totalTarget += entry.target_quantity || 0;
    acc[empId].totalActual += entry.actual_quantity || 0;
    acc[empId].entries += 1;
    return acc;
  }, {} as Record<string, any>);

  const rankedEmployees = Object.values(employeeStats)
    .map((e: any) => ({
      ...e,
      efficiency: e.totalTarget > 0 ? (e.totalActual / e.totalTarget) * 100 : 0,
    }))
    .sort((a: any, b: any) => b.efficiency - a.efficiency);

  const topPerformers = rankedEmployees.slice(0, 5);
  const bottomPerformers = rankedEmployees.slice(-5).reverse();

  // Department-wise aggregation
  const departmentStats = productivityData.reduce((acc, entry) => {
    const deptId = entry.department_id;
    const deptName = entry.production_departments?.name || "Unknown";
    if (!acc[deptId]) {
      acc[deptId] = { name: deptName, totalTarget: 0, totalActual: 0 };
    }
    acc[deptId].totalTarget += entry.target_quantity || 0;
    acc[deptId].totalActual += entry.actual_quantity || 0;
    return acc;
  }, {} as Record<string, any>);

  const departmentChartData = Object.values(departmentStats).map((d: any) => ({
    name: d.name,
    target: d.totalTarget,
    actual: d.totalActual,
    efficiency: d.totalTarget > 0 ? Math.round((d.totalActual / d.totalTarget) * 100) : 0,
  }));

  // Daily trend data
  const dailyTrend = productivityData.reduce((acc, entry) => {
    const date = entry.target_date;
    if (!acc[date]) {
      acc[date] = { date, target: 0, actual: 0 };
    }
    acc[date].target += entry.target_quantity || 0;
    acc[date].actual += entry.actual_quantity || 0;
    return acc;
  }, {} as Record<string, any>);

  const trendChartData = Object.values(dailyTrend)
    .sort((a: any, b: any) => a.date.localeCompare(b.date))
    .map((d: any) => ({
      ...d,
      date: format(new Date(d.date), "MMM dd"),
      efficiency: d.target > 0 ? Math.round((d.actual / d.target) * 100) : 0,
    }));

  const getEfficiencyColor = (efficiency: number) => {
    if (efficiency >= 100) return "text-green-600";
    if (efficiency >= 80) return "text-yellow-600";
    return "text-red-600";
  };

  const getEfficiencyBadge = (efficiency: number) => {
    if (efficiency >= 100) return "default";
    if (efficiency >= 80) return "secondary";
    return "destructive";
  };

  // Employee deployment by department with full details
  const deploymentByDept = productivityData.reduce((acc, entry) => {
    const deptId = entry.department_id;
    const deptName = entry.production_departments?.name || "Unknown";

    if (!acc[deptId]) {
      acc[deptId] = { name: deptName, entries: [], totalMph: 0, totalTarget: 0, totalActual: 0 };
    }
    
    acc[deptId].entries.push({
      id: entry.id,
      empName: (entry as any).labour_employees?.full_name || "Unknown",
      empCode: (entry as any).labour_employees?.employee_code || "",
      category: (entry as any).labour_employees?.category || "-",
      process: (entry as any).qa_processes?.name || "-",
      workType: entry.work_type === "full_day" ? "Full Day" : "Half Day",
      mph: Number(entry.mph || 0),
      target: entry.target_quantity || 0,
      actual: entry.actual_quantity || 0,
      efficiency: Number(entry.efficiency_percentage || 0),
      remarks: entry.remarks || "",
      entryBy: (entry as any).created_by_user?.full_name || "-",
    });
    acc[deptId].totalMph += Number(entry.mph || 0);
    acc[deptId].totalTarget += entry.target_quantity || 0;
    acc[deptId].totalActual += entry.actual_quantity || 0;
    
    return acc;
  }, {} as Record<string, { 
    name: string; 
    entries: Array<{
      id: string;
      empName: string;
      empCode: string;
      category: string;
      process: string;
      workType: string;
      mph: number;
      target: number;
      actual: number;
      efficiency: number;
      remarks: string;
      entryBy: string;
    }>;
    totalMph: number;
    totalTarget: number;
    totalActual: number;
  }>);

  const deploymentData = Object.entries(deploymentByDept).map(([deptId, dept]) => ({
    deptId,
    deptName: dept.name,
    entries: dept.entries,
    totalEmployees: new Set(dept.entries.map(e => e.empCode)).size,
    totalMph: dept.totalMph,
    totalTarget: dept.totalTarget,
    totalActual: dept.totalActual,
    avgEfficiency: dept.totalTarget > 0 ? (dept.totalActual / dept.totalTarget) * 100 : 0,
  }));

  // Overall totals
  const totalMph = productivityData.reduce((sum, d) => sum + Number(d.mph || 0), 0);

  const handleAiInsights = async (dept: typeof deploymentData[0]) => {
    setAiLoading(true);
    setAiDeptName(dept.deptName);
    setAiInsights("");
    setAiEfficiency(dept.avgEfficiency);
    setAiDialogOpen(true);

    try {
      const { start, end } = getDateFilter();
      const { data, error } = await supabase.functions.invoke("labour-ai-insights", {
        body: {
          departmentName: dept.deptName,
          dateRange: `${start} to ${end}`,
          stats: {
            totalEmployees: dept.totalEmployees,
            totalMph: dept.totalMph,
            totalTarget: dept.totalTarget,
            totalActual: dept.totalActual,
          },
          workers: dept.entries.slice(0, 30),
        },
      });

      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        setAiDialogOpen(false);
      } else {
        setAiInsights(data.insights);
        setAiEfficiency(data.avgEfficiency || dept.avgEfficiency);
      }
    } catch (e: any) {
      toast.error(e.message || "AI analysis failed");
      setAiDialogOpen(false);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Labour Productivity Dashboard"
        description="Track worker performance and department efficiency"
      />

      <div className="flex flex-wrap gap-4 mb-6">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Date range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">Last 7 Days</SelectItem>
            <SelectItem value="month">This Month</SelectItem>
            <SelectItem value="custom">Custom Date</SelectItem>
          </SelectContent>
        </Select>

        {dateRange === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "w-[200px] justify-start text-left font-normal",
                  !customDate && "text-muted-foreground"
                )}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {customDate ? format(customDate, "PPP") : <span>Pick a date</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={customDate}
                onSelect={setCustomDate}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        )}

        <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Total Workers"
          value={totalWorkers.toString()}
          icon={Users}
        />
        <MetricCard
          title="Avg Efficiency"
          value={`${avgEfficiency.toFixed(1)}%`}
          icon={TrendingUp}
        />
        <MetricCard
          title="Top Performer"
          value={topPerformers[0]?.employee?.full_name || "-"}
          icon={Award}
        />
        <MetricCard
          title="Departments Active"
          value={Object.keys(departmentStats).length.toString()}
          icon={Building2}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Department Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Department Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={departmentChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={12} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="target" fill="#94a3b8" name="Target" />
                <Bar dataKey="actual" fill="#3b82f6" name="Actual" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Efficiency Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Efficiency Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" fontSize={12} />
                <YAxis domain={[0, 150]} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="efficiency" stroke="#10b981" name="Efficiency %" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top/Bottom Performers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Award className="h-4 w-4 text-yellow-500" />
              Top Performers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topPerformers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data available</p>
              ) : (
                topPerformers.map((performer: any, index) => (
                  <div key={performer.employee?.id || index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-muted-foreground">#{index + 1}</span>
                      <div>
                        <p className="font-medium">{performer.employee?.full_name}</p>
                        <p className="text-xs text-muted-foreground">{performer.department?.name}</p>
                      </div>
                    </div>
                    <Badge variant={getEfficiencyBadge(performer.efficiency)}>
                      {performer.efficiency.toFixed(1)}%
                    </Badge>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bottom Performers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-500 rotate-180" />
              Needs Improvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {bottomPerformers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data available</p>
              ) : (
                bottomPerformers.map((performer: any, index) => (
                  <div key={performer.employee?.id || index} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium">{performer.employee?.full_name}</p>
                        <p className="text-xs text-muted-foreground">{performer.department?.name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={Math.min(performer.efficiency, 100)} className="w-20" />
                      <Badge variant={getEfficiencyBadge(performer.efficiency)}>
                        {performer.efficiency.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Employee Deployment by Department */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Employee Deployment
            </span>
            <Badge variant="outline" className="text-sm">
              Total: {totalWorkers} Workers | {totalMph} MPH
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deploymentData.length === 0 ? (
            <p className="text-sm text-muted-foreground">No deployment data available</p>
          ) : (
            <div className="space-y-6">
              {deploymentData.map((dept) => (
                <div key={dept.deptId} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold text-sm">{dept.deptName}</h4>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => handleAiInsights(dept)}
                        title="AI Insights"
                      >
                        <Sparkles className="h-4 w-4 text-primary" />
                      </Button>
                    </div>
                    <div className="flex gap-3">
                      <Badge variant="secondary">{dept.totalEmployees} Workers</Badge>
                      <Badge variant="outline">{dept.totalMph} MPH</Badge>
                      <Badge variant={dept.avgEfficiency >= 100 ? "default" : dept.avgEfficiency >= 80 ? "secondary" : "destructive"}>
                        {dept.avgEfficiency.toFixed(1)}% Eff
                      </Badge>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">Employee</th>
                          <th className="text-left p-2 font-medium">Category</th>
                          <th className="text-left p-2 font-medium">Process</th>
                          <th className="text-left p-2 font-medium">Work Type</th>
                          <th className="text-right p-2 font-medium">MPH</th>
                          <th className="text-right p-2 font-medium">Target</th>
                          <th className="text-right p-2 font-medium">Actual</th>
                          <th className="text-right p-2 font-medium">Efficiency</th>
                          <th className="text-left p-2 font-medium">Entry By</th>
                          <th className="text-left p-2 font-medium">Remarks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dept.entries.map((entry, idx) => (
                          <tr key={entry.id || idx} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="p-2">
                              <div>
                                <span className="font-medium">{entry.empName}</span>
                                <span className="text-xs text-muted-foreground ml-1">({entry.empCode})</span>
                              </div>
                            </td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">{entry.category}</Badge>
                            </td>
                            <td className="p-2">{entry.process}</td>
                            <td className="p-2">
                              <Badge variant="outline" className="text-xs">
                                {entry.workType}
                              </Badge>
                            </td>
                            <td className="p-2 text-right">{entry.mph}</td>
                            <td className="p-2 text-right">{entry.target}</td>
                            <td className="p-2 text-right">{entry.actual}</td>
                            <td className="p-2 text-right">
                              <Badge variant={entry.efficiency >= 100 ? "default" : entry.efficiency >= 80 ? "secondary" : "destructive"}>
                                {entry.efficiency.toFixed(1)}%
                              </Badge>
                            </td>
                            <td className="p-2 text-muted-foreground">{entry.entryBy}</td>
                            <td className="p-2 text-muted-foreground max-w-[250px] whitespace-normal break-words text-xs">{entry.remarks || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Insights Dialog */}
      <Dialog open={aiDialogOpen} onOpenChange={setAiDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                AI Insights — {aiDeptName}
              </span>
              {!aiLoading && aiInsights && (
                <Button
                  variant="outline"
                  size="sm"
                  className="print:hidden"
                  onClick={() => {
                    const printWindow = window.open("", "_blank");
                    if (printWindow) {
                      const content = document.getElementById("ai-insights-content")?.innerHTML || "";
                      printWindow.document.write(`
                        <html>
                          <head>
                            <title>AI Insights — ${aiDeptName}</title>
                            <style>
                              body { font-family: Arial, sans-serif; padding: 20px; direction: rtl; }
                              h1 { font-size: 18px; border-bottom: 2px solid #333; padding-bottom: 8px; direction: ltr; }
                              h2 { font-size: 16px; margin-top: 20px; color: #333; direction: ltr; }
                              ul { padding-right: 20px; }
                              li { margin-bottom: 6px; }
                              .text-destructive, .text-destructive * { color: #dc2626 !important; }
                            </style>
                          </head>
                          <body>
                            <h1 style="direction:ltr">AI Insights — ${aiDeptName}</h1>
                            ${content}
                          </body>
                        </html>
                      `);
                      printWindow.document.close();
                      printWindow.print();
                    }
                  }}
                >
                  <Printer className="h-4 w-4 mr-1" />
                  Print
                </Button>
              )}
            </DialogTitle>
          </DialogHeader>
          {aiLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-muted-foreground">Analyzing productivity data...</span>
            </div>
          ) : (
            <div
              id="ai-insights-content"
              className={`prose prose-sm max-w-none ${aiEfficiency < 80 ? "text-destructive prose-headings:text-destructive prose-strong:text-destructive" : "dark:prose-invert"}`}
              dir="rtl"
            >
              <ReactMarkdown>{aiInsights}</ReactMarkdown>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
};

export default LabourProductivityDashboard;
