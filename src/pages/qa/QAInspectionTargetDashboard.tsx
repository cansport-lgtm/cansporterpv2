import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { 
  Target, 
  CalendarIcon, 
  Save, 
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Clock,
  Printer
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  CartesianGrid,
  LineChart,
  Line
} from "recharts";

export default function QAInspectionTargetDashboard() {
  const { user, hasRole } = useAuth();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [achievementDate, setAchievementDate] = useState<Date>(new Date());
  const [selectedMonth, setSelectedMonth] = useState<Date>(new Date());
  const [targetInputs, setTargetInputs] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState("daily");

  const dateStr = format(selectedDate, "yyyy-MM-dd");
  const achievementDateStr = format(achievementDate, "yyyy-MM-dd");
  const monthStart = format(startOfMonth(selectedMonth), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(selectedMonth), "yyyy-MM-dd");

  // Check if user is super_admin
  const isSuperAdmin = hasRole("super_admin");

  // Fetch all active processes
  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-targets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("id, code, name, sequence_order")
        .eq("is_active", true)
        .order("sequence_order", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch the latest target for each process (for recurring targets)
  const { data: latestTargets = [] } = useQuery({
    queryKey: ["qa-latest-targets"],
    queryFn: async () => {
      // Get the most recent target for each process
      const { data, error } = await supabase
        .from("qa_inspection_targets")
        .select("process_id, target_count, target_date")
        .order("target_date", { ascending: false });
      if (error) throw error;
      
      // Get the latest target per process
      const latestByProcess: Record<string, { target_count: number; target_date: string }> = {};
      (data || []).forEach((t: any) => {
        if (!latestByProcess[t.process_id]) {
          latestByProcess[t.process_id] = { target_count: t.target_count, target_date: t.target_date };
        }
      });
      return latestByProcess;
    },
  });

  // Fetch targets for selected date
  const { data: dailyTargets = [] } = useQuery({
    queryKey: ["qa-inspection-targets", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspection_targets")
        .select("*, qa_processes(name, code)")
        .eq("target_date", dateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch inspections for selected date
  const { data: dailyInspections = [] } = useQuery({
    queryKey: ["qa-daily-inspections", dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("process_id, result")
        .eq("inspection_date", dateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch targets for achievement date (separate from target setting date)
  const { data: achievementTargets = [] } = useQuery({
    queryKey: ["qa-achievement-targets", achievementDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspection_targets")
        .select("*, qa_processes(name, code)")
        .eq("target_date", achievementDateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch inspections for achievement date
  const { data: achievementInspections = [] } = useQuery({
    queryKey: ["qa-achievement-inspections", achievementDateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("process_id, result")
        .eq("inspection_date", achievementDateStr);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch monthly targets
  const { data: monthlyTargets = [] } = useQuery({
    queryKey: ["qa-monthly-targets", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspection_targets")
        .select("*, qa_processes(name, code)")
        .gte("target_date", monthStart)
        .lte("target_date", monthEnd);
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch monthly inspections
  const { data: monthlyInspections = [] } = useQuery({
    queryKey: ["qa-monthly-inspections", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("process_id, result, inspection_date")
        .gte("inspection_date", monthStart)
        .lte("inspection_date", monthEnd);
      if (error) throw error;
      return data || [];
    },
  });

  // Save target mutation
  const saveTargetMutation = useMutation({
    mutationFn: async ({ processId, targetCount }: { processId: string; targetCount: number }) => {
      const { data: existing } = await supabase
        .from("qa_inspection_targets")
        .select("id")
        .eq("target_date", dateStr)
        .eq("process_id", processId)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("qa_inspection_targets")
          .update({ target_count: targetCount, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("qa_inspection_targets")
          .insert({
            target_date: dateStr,
            process_id: processId,
            target_count: targetCount,
            created_by: user?.id,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-inspection-targets"] });
      queryClient.invalidateQueries({ queryKey: ["qa-monthly-targets"] });
      toast.success("Target saved successfully");
    },
    onError: (error: any) => {
      toast.error("Failed to save target: " + error.message);
    },
  });

  // Build daily achievement data - use recurring target if no specific target for this date
  const dailyAchievementData = useMemo(() => {
    return processes.map((process) => {
      const target = dailyTargets.find((t: any) => t.process_id === process.id);
      const actualCount = dailyInspections.filter((i: any) => i.process_id === process.id).length;
      
      // Use the target for this date, or fall back to the latest recurring target
      const latestTarget = latestTargets[process.id];
      const targetCount = target?.target_count ?? latestTarget?.target_count ?? 0;
      const achievement = targetCount > 0 ? Math.round((actualCount / targetCount) * 100) : 0;

      return {
        process: `${process.code} - ${process.name}`,
        processId: process.id,
        code: process.code,
        name: process.name,
        target: targetCount,
        actual: actualCount,
        achievement,
        pending: Math.max(0, targetCount - actualCount),
        isRecurring: !target && !!latestTarget, // Flag if using recurring target
      };
    });
  }, [processes, dailyTargets, dailyInspections, latestTargets]);

  // Build achievement status data for the achievement date (separate from target setting)
  const achievementStatusData = useMemo(() => {
    return processes.map((process) => {
      const target = achievementTargets.find((t: any) => t.process_id === process.id);
      const actualCount = achievementInspections.filter((i: any) => i.process_id === process.id).length;
      
      // Use the target for this date, or fall back to the latest recurring target
      const latestTarget = latestTargets[process.id];
      const targetCount = target?.target_count ?? latestTarget?.target_count ?? 0;
      const achievement = targetCount > 0 ? Math.round((actualCount / targetCount) * 100) : 0;

      return {
        process: `${process.code} - ${process.name}`,
        processId: process.id,
        code: process.code,
        name: process.name,
        target: targetCount,
        actual: actualCount,
        achievement,
        pending: Math.max(0, targetCount - actualCount),
        isRecurring: !target && !!latestTarget,
      };
    });
  }, [processes, achievementTargets, achievementInspections, latestTargets]);

  // Build monthly summary by process
  const monthlySummaryByProcess = useMemo(() => {
    return processes.map((process) => {
      const processTargets = monthlyTargets.filter((t: any) => t.process_id === process.id);
      const totalTarget = processTargets.reduce((sum: number, t: any) => sum + t.target_count, 0);
      const actualCount = monthlyInspections.filter((i: any) => i.process_id === process.id).length;
      const achievement = totalTarget > 0 ? Math.round((actualCount / totalTarget) * 100) : 0;

      return {
        process: `${process.code} - ${process.name}`,
        code: process.code,
        name: process.name,
        target: totalTarget,
        actual: actualCount,
        achievement,
        daysWithTarget: processTargets.length,
      };
    }).filter(p => p.target > 0 || p.actual > 0);
  }, [processes, monthlyTargets, monthlyInspections]);

  // Build daily trend for the month
  const dailyTrendData = useMemo(() => {
    const daysInMonth = eachDayOfInterval({
      start: startOfMonth(selectedMonth),
      end: endOfMonth(selectedMonth),
    });

    return daysInMonth.map((day) => {
      const dayStr = format(day, "yyyy-MM-dd");
      const dayTargets = monthlyTargets.filter((t: any) => t.target_date === dayStr);
      const dayInspections = monthlyInspections.filter((i: any) => i.inspection_date === dayStr);
      
      const totalTarget = dayTargets.reduce((sum: number, t: any) => sum + t.target_count, 0);
      const totalActual = dayInspections.length;

      return {
        date: format(day, "dd"),
        fullDate: dayStr,
        target: totalTarget,
        actual: totalActual,
        achievement: totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0,
      };
    });
  }, [selectedMonth, monthlyTargets, monthlyInspections]);

  // Calculate summary metrics
  const summaryMetrics = useMemo(() => {
    const totalDailyTarget = dailyAchievementData.reduce((sum, d) => sum + d.target, 0);
    const totalDailyActual = dailyAchievementData.reduce((sum, d) => sum + d.actual, 0);
    const dailyAchievement = totalDailyTarget > 0 ? Math.round((totalDailyActual / totalDailyTarget) * 100) : 0;
    const processesOnTarget = dailyAchievementData.filter(d => d.target > 0 && d.actual >= d.target).length;
    const processesBehind = dailyAchievementData.filter(d => d.target > 0 && d.actual < d.target).length;

    const totalMonthlyTarget = monthlySummaryByProcess.reduce((sum, p) => sum + p.target, 0);
    const totalMonthlyActual = monthlySummaryByProcess.reduce((sum, p) => sum + p.actual, 0);
    const monthlyAchievement = totalMonthlyTarget > 0 ? Math.round((totalMonthlyActual / totalMonthlyTarget) * 100) : 0;

    return {
      totalDailyTarget,
      totalDailyActual,
      dailyAchievement,
      processesOnTarget,
      processesBehind,
      totalMonthlyTarget,
      totalMonthlyActual,
      monthlyAchievement,
    };
  }, [dailyAchievementData, monthlySummaryByProcess]);

  const handleTargetChange = (processId: string, value: string) => {
    setTargetInputs((prev) => ({
      ...prev,
      [processId]: parseInt(value) || 0,
    }));
  };

  const handleSaveTarget = (processId: string) => {
    const targetCount = targetInputs[processId];
    if (targetCount !== undefined) {
      saveTargetMutation.mutate({ processId, targetCount });
    }
  };

  const handleSaveAllTargets = () => {
    Object.entries(targetInputs).forEach(([processId, targetCount]) => {
      if (targetCount !== undefined && targetCount >= 0) {
        saveTargetMutation.mutate({ processId, targetCount });
      }
    });
  };

  // Initialize target inputs when daily targets change - use recurring targets as defaults
  useEffect(() => {
    const initialInputs: Record<string, number> = {};
    processes.forEach((process) => {
      const existingTarget = dailyTargets.find((t: any) => t.process_id === process.id);
      // Use existing target for this date, or fall back to latest recurring target
      const latestTarget = latestTargets[process.id];
      initialInputs[process.id] = existingTarget?.target_count ?? latestTarget?.target_count ?? 0;
    });
    setTargetInputs(initialInputs);
  }, [processes, dailyTargets, latestTargets]);

  return (
    <ERPLayout>
      <PageHeader
        title="QA Inspection Target Dashboard"
        description="Set daily targets and track inspection achievements"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="daily">Daily View</TabsTrigger>
          <TabsTrigger value="monthly">Monthly View</TabsTrigger>
        </TabsList>

        {/* Daily View Tab */}
        <TabsContent value="daily" className="space-y-6">
          {/* Date Picker & Summary Metrics */}
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedDate, "PPP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => date && setSelectedDate(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Daily Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              title="Total Target"
              value={summaryMetrics.totalDailyTarget}
              icon={Target}
              iconColor="text-blue-500"
            />
            <MetricCard
              title="Inspections Done"
              value={summaryMetrics.totalDailyActual}
              icon={CheckCircle2}
              iconColor="text-green-500"
            />
            <MetricCard
              title="Achievement %"
              value={`${summaryMetrics.dailyAchievement}%`}
              icon={TrendingUp}
              iconColor="text-purple-500"
            />
            <MetricCard
              title="Processes Behind"
              value={summaryMetrics.processesBehind}
              icon={AlertTriangle}
              iconColor="text-amber-500"
            />
          </div>

          {/* Target Setting & Achievement Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Set Targets Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Set Daily Targets
                  {!isSuperAdmin && (
                    <Badge variant="secondary" className="ml-2">View Only</Badge>
                  )}
                </CardTitle>
                {isSuperAdmin && (
                  <Button size="sm" onClick={handleSaveAllTargets} disabled={saveTargetMutation.isPending}>
                    <Save className="h-4 w-4 mr-2" />
                    Save All
                  </Button>
                )}
              </CardHeader>
              <CardContent>
                {!isSuperAdmin && (
                  <div className="mb-4 p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                    Only Super Admin can edit inspection targets. Targets automatically recur daily until changed.
                  </div>
                )}
                <div className="max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Process</TableHead>
                        <TableHead className="w-24">Target</TableHead>
                        <TableHead className="w-20">Status</TableHead>
                        {isSuperAdmin && <TableHead className="w-16"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processes.map((process) => {
                        const processData = dailyAchievementData.find(d => d.processId === process.id);
                        const isRecurring = processData?.isRecurring;
                        return (
                          <TableRow key={process.id}>
                            <TableCell className="font-medium">
                              <span className="text-muted-foreground">{process.code}</span>
                              {" - "}
                              {process.name}
                            </TableCell>
                            <TableCell>
                              {isSuperAdmin ? (
                                <Input
                                  type="number"
                                  min={0}
                                  value={targetInputs[process.id] || 0}
                                  onChange={(e) => handleTargetChange(process.id, e.target.value)}
                                  className="h-8 w-20"
                                />
                              ) : (
                                <span className="font-medium">{targetInputs[process.id] || 0}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              {isRecurring ? (
                                <Badge variant="outline" className="text-xs">Recurring</Badge>
                              ) : targetInputs[process.id] > 0 ? (
                                <Badge variant="default" className="text-xs">Set</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">No Target</Badge>
                              )}
                            </TableCell>
                            {isSuperAdmin && (
                              <TableCell>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleSaveTarget(process.id)}
                                  disabled={saveTargetMutation.isPending}
                                >
                                  <Save className="h-4 w-4" />
                                </Button>
                              </TableCell>
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* Achievement Status Card */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Daily Achievement Status
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      const filteredData = achievementStatusData.filter(d => d.target > 0);
                      const rows = filteredData.map(d => `
                        <tr>
                          <td style="padding:6px 10px;border:1px solid #ddd;">${d.code} - ${d.name}</td>
                          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${d.target}</td>
                          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${d.actual}</td>
                          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;">${d.pending}</td>
                          <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;color:${d.achievement >= 100 ? 'green' : d.achievement >= 50 ? '#b45309' : 'red'};font-weight:600;">${d.achievement}%</td>
                        </tr>
                      `).join("");
                      const totalTarget = filteredData.reduce((s, d) => s + d.target, 0);
                      const totalActual = filteredData.reduce((s, d) => s + d.actual, 0);
                      const totalPending = filteredData.reduce((s, d) => s + d.pending, 0);
                      const overallAch = totalTarget > 0 ? Math.round((totalActual / totalTarget) * 100) : 0;
                      const printWindow = window.open("", "_blank");
                      if (printWindow) {
                        printWindow.document.write(`<html><head><title>Daily Achievement Status - ${format(achievementDate, "dd MMM yyyy")}</title></head><body style="font-family:Arial,sans-serif;padding:20px;">
                          <h2 style="margin-bottom:4px;">QA Inspection - Daily Achievement Status</h2>
                          <p style="color:#666;margin-bottom:16px;">Date: ${format(achievementDate, "dd MMM yyyy")}</p>
                          <table style="width:100%;border-collapse:collapse;font-size:13px;">
                            <thead><tr style="background:#f3f4f6;">
                              <th style="padding:8px 10px;border:1px solid #ddd;text-align:left;">Process</th>
                              <th style="padding:8px 10px;border:1px solid #ddd;">Target</th>
                              <th style="padding:8px 10px;border:1px solid #ddd;">Actual</th>
                              <th style="padding:8px 10px;border:1px solid #ddd;">Pending</th>
                              <th style="padding:8px 10px;border:1px solid #ddd;">Achievement</th>
                            </tr></thead>
                            <tbody>${rows}
                              <tr style="font-weight:bold;background:#f9fafb;">
                                <td style="padding:8px 10px;border:1px solid #ddd;">Total</td>
                                <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${totalTarget}</td>
                                <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${totalActual}</td>
                                <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${totalPending}</td>
                                <td style="padding:8px 10px;border:1px solid #ddd;text-align:center;">${overallAch}%</td>
                              </tr>
                            </tbody>
                          </table>
                          <p style="margin-top:20px;font-size:11px;color:#999;">Printed on ${format(new Date(), "dd MMM yyyy HH:mm")}</p>
                        </body></html>`);
                        printWindow.document.close();
                        printWindow.print();
                      }
                    }}
                  >
                    <Printer className="h-4 w-4" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8">
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(achievementDate, "dd MMM yyyy")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="end">
                      <Calendar
                        mode="single"
                        selected={achievementDate}
                        onSelect={(date) => date && setAchievementDate(date)}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-[400px] overflow-y-auto space-y-4">
                  {achievementStatusData.filter(d => d.target > 0).map((data) => (
                    <div key={data.processId} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate max-w-[200px]">
                          {data.code} - {data.name}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">
                            {data.actual}/{data.target}
                          </span>
                          <Badge
                            variant={data.achievement >= 100 ? "default" : data.achievement >= 50 ? "secondary" : "destructive"}
                          >
                            {data.achievement}%
                          </Badge>
                        </div>
                      </div>
                      <Progress
                        value={Math.min(data.achievement, 100)}
                        className={cn(
                          "h-2",
                          data.achievement >= 100 && "[&>div]:bg-green-500"
                        )}
                      />
                    </div>
                  ))}
                  {achievementStatusData.filter(d => d.target > 0).length === 0 && (
                    <p className="text-muted-foreground text-center py-8">
                      No processes with targets configured
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Daily Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Target vs Actual by Process</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dailyAchievementData.filter(d => d.target > 0)}
                    layout="vertical"
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" />
                    <YAxis 
                      dataKey="code" 
                      type="category" 
                      width={60}
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip 
                      formatter={(value, name) => [value, name === "target" ? "Target" : "Actual"]}
                      labelFormatter={(label) => {
                        const item = dailyAchievementData.find(d => d.code === label);
                        return item ? item.process : label;
                      }}
                    />
                    <Legend />
                    <Bar dataKey="target" fill="hsl(var(--muted-foreground))" name="Target" />
                    <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Monthly View Tab */}
        <TabsContent value="monthly" className="space-y-6">
          {/* Month Picker */}
          <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(selectedMonth, "MMMM yyyy")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedMonth}
                  onSelect={(date) => date && setSelectedMonth(date)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Monthly Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <MetricCard
              title="Monthly Target"
              value={summaryMetrics.totalMonthlyTarget}
              icon={Target}
              iconColor="text-blue-500"
            />
            <MetricCard
              title="Total Inspections"
              value={summaryMetrics.totalMonthlyActual}
              icon={CheckCircle2}
              iconColor="text-green-500"
            />
            <MetricCard
              title="Achievement %"
              value={`${summaryMetrics.monthlyAchievement}%`}
              icon={TrendingUp}
              iconColor="text-purple-500"
            />
            <MetricCard
              title="Days with Targets"
              value={new Set(monthlyTargets.map((t: any) => t.target_date)).size}
              icon={Clock}
              iconColor="text-cyan-500"
            />
          </div>

          {/* Daily Trend Line Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Daily Trend - {format(selectedMonth, "MMMM yyyy")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyTrendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      labelFormatter={(label, payload) => {
                        const item = payload?.[0]?.payload;
                        return item ? format(new Date(item.fullDate), "PPP") : label;
                      }}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="target" 
                      stroke="hsl(var(--muted-foreground))" 
                      name="Target"
                      strokeWidth={2}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="actual" 
                      stroke="hsl(var(--primary))" 
                      name="Actual"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Process Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Achievement by Process</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process</TableHead>
                    <TableHead className="text-right">Total Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">Achievement</TableHead>
                    <TableHead className="text-right">Days with Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlySummaryByProcess.map((data) => (
                    <TableRow key={data.code}>
                      <TableCell className="font-medium">
                        <span className="text-muted-foreground">{data.code}</span>
                        {" - "}
                        {data.name}
                      </TableCell>
                      <TableCell className="text-right">{data.target}</TableCell>
                      <TableCell className="text-right">{data.actual}</TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant={data.achievement >= 100 ? "default" : data.achievement >= 50 ? "secondary" : "destructive"}
                        >
                          {data.achievement}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{data.daysWithTarget}</TableCell>
                    </TableRow>
                  ))}
                  {monthlySummaryByProcess.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                        No data available for this month
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Monthly Bar Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Process-wise Monthly Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[400px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlySummaryByProcess}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="code" 
                      angle={-45} 
                      textAnchor="end" 
                      height={60}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis />
                    <Tooltip 
                      formatter={(value, name) => [value, name === "target" ? "Target" : "Actual"]}
                      labelFormatter={(label) => {
                        const item = monthlySummaryByProcess.find(d => d.code === label);
                        return item ? `${item.code} - ${item.name}` : label;
                      }}
                    />
                    <Legend />
                    <Bar dataKey="target" fill="hsl(var(--muted-foreground))" name="Target" />
                    <Bar dataKey="actual" fill="hsl(var(--primary))" name="Actual" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
