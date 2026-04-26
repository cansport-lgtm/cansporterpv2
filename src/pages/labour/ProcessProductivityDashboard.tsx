import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { Activity, Target, TrendingUp, CalendarIcon, BarChart3, PieChart, Building2 } from "lucide-react";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart as RechartsPie, Pie, Cell } from "recharts";
import { cn } from "@/lib/utils";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

const ProcessProductivityDashboard = () => {
  const [dateRange, setDateRange] = useState("today");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [customDate, setCustomDate] = useState<Date | undefined>(new Date());

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
    queryKey: ["process-productivity", dateRange, selectedDepartment, customDate?.toISOString()],
    queryFn: async () => {
      const { start, end } = getDateFilter();
      let query = supabase
        .from("labour_productivity_targets")
        .select(`
          *,
          labour_employees(id, full_name, employee_code),
          production_departments(id, name, code),
          qa_processes(id, name, code)
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

  // Aggregate by process
  const processStats = productivityData.reduce((acc, entry) => {
    const processId = entry.process_id;
    const processName = (entry as any).qa_processes?.name || "Unknown Process";
    const processCode = (entry as any).qa_processes?.code || "";
    
    if (!acc[processId]) {
      acc[processId] = {
        processId,
        processName,
        processCode,
        totalTarget: 0,
        totalActual: 0,
        entryCount: 0,
        workerCount: new Set(),
        departments: new Set(),
        entries: [],
      };
    }
    
    acc[processId].totalTarget += entry.target_quantity || 0;
    acc[processId].totalActual += entry.actual_quantity || 0;
    acc[processId].entryCount += 1;
    acc[processId].workerCount.add(entry.employee_id);
    if (entry.production_departments?.name) {
      acc[processId].departments.add(entry.production_departments.name);
    }
    acc[processId].entries.push({
      id: entry.id,
      date: entry.target_date,
      employee: (entry as any).labour_employees?.full_name || "Unknown",
      department: entry.production_departments?.name || "Unknown",
      target: entry.target_quantity || 0,
      actual: entry.actual_quantity || 0,
      efficiency: Number(entry.efficiency_percentage || 0),
    });
    
    return acc;
  }, {} as Record<string, any>);

  // Aggregate by department
  const departmentStats = productivityData.reduce((acc, entry) => {
    const deptId = entry.department_id;
    const deptName = entry.production_departments?.name || "Unknown Department";
    const deptCode = entry.production_departments?.code || "";
    
    if (!acc[deptId]) {
      acc[deptId] = {
        deptId,
        deptName,
        deptCode,
        totalTarget: 0,
        totalActual: 0,
        entryCount: 0,
        workerCount: new Set(),
        processCount: new Set(),
      };
    }
    
    acc[deptId].totalTarget += entry.target_quantity || 0;
    acc[deptId].totalActual += entry.actual_quantity || 0;
    acc[deptId].entryCount += 1;
    acc[deptId].workerCount.add(entry.employee_id);
    if (entry.process_id) {
      acc[deptId].processCount.add(entry.process_id);
    }
    
    return acc;
  }, {} as Record<string, any>);

  const departmentData = Object.values(departmentStats)
    .map((d: any) => ({
      ...d,
      workerCount: d.workerCount.size,
      processCount: d.processCount.size,
      efficiency: d.totalTarget > 0 ? (d.totalActual / d.totalTarget) * 100 : 0,
    }))
    .sort((a: any, b: any) => b.totalActual - a.totalActual);

  // Department chart data
  const departmentChartData = departmentData.map((d: any, index: number) => ({
    name: d.deptName.length > 12 ? d.deptName.substring(0, 12) + "..." : d.deptName,
    fullName: d.deptName,
    target: d.totalTarget,
    actual: d.totalActual,
    efficiency: Math.round(d.efficiency),
    color: COLORS[index % COLORS.length],
  }));

  const processData = Object.values(processStats)
    .map((p: any) => ({
      ...p,
      workerCount: p.workerCount.size,
      departments: Array.from(p.departments),
      efficiency: p.totalTarget > 0 ? (p.totalActual / p.totalTarget) * 100 : 0,
    }))
    .sort((a: any, b: any) => b.entryCount - a.entryCount);

  // Top 10 processes for chart
  const topProcesses = processData.slice(0, 10);
  
  // Chart data
  const chartData = topProcesses.map((p: any) => ({
    name: p.processName.length > 15 ? p.processName.substring(0, 15) + "..." : p.processName,
    fullName: p.processName,
    target: p.totalTarget,
    actual: p.totalActual,
    efficiency: Math.round(p.efficiency),
  }));

  // Pie chart data for distribution
  const pieData = topProcesses.slice(0, 8).map((p: any, index: number) => ({
    name: p.processName,
    value: p.totalActual,
    color: COLORS[index % COLORS.length],
  }));

  // Summary metrics
  const totalProcesses = processData.length;
  const totalTarget = processData.reduce((sum: number, p: any) => sum + p.totalTarget, 0);
  const totalActual = processData.reduce((sum: number, p: any) => sum + p.totalActual, 0);
  const overallEfficiency = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

  const getEfficiencyBadge = (efficiency: number) => {
    if (efficiency >= 100) return "default";
    if (efficiency >= 80) return "secondary";
    return "destructive";
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Process Productivity Dashboard"
        description="Analyze productivity by process - target vs actual performance"
        icon={Activity}
      />

      {/* Filters */}
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
          title="Active Processes"
          value={totalProcesses.toString()}
          icon={Activity}
        />
        <MetricCard
          title="Total Target"
          value={totalTarget.toLocaleString()}
          icon={Target}
        />
        <MetricCard
          title="Total Achieved"
          value={totalActual.toLocaleString()}
          icon={BarChart3}
        />
        <MetricCard
          title="Overall Efficiency"
          value={`${overallEfficiency.toFixed(1)}%`}
          icon={TrendingUp}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Process Performance Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Top 10 Processes - Target vs Actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={chartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} fontSize={11} />
                  <Tooltip 
                    formatter={(value, name) => [value.toLocaleString(), name]}
                    labelFormatter={(label) => chartData.find(d => d.name === label)?.fullName || label}
                  />
                  <Legend />
                  <Bar dataKey="target" fill="#94a3b8" name="Target" />
                  <Bar dataKey="actual" fill="#3b82f6" name="Actual" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Production Distribution Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              Production Distribution by Process
            </CardTitle>
          </CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <RechartsPie>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name.substring(0, 10)}... ${(percent * 100).toFixed(0)}%`}
                    outerRadius={120}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toLocaleString()} />
                </RechartsPie>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Department-wise Productivity Chart */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Department-wise Productivity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {departmentChartData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Department Bar Chart */}
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={departmentChartData} margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" fontSize={11} angle={-45} textAnchor="end" height={70} />
                  <YAxis fontSize={11} />
                  <Tooltip 
                    formatter={(value, name) => [value.toLocaleString(), name]}
                    labelFormatter={(label) => departmentChartData.find(d => d.name === label)?.fullName || label}
                  />
                  <Legend />
                  <Bar dataKey="target" fill="#94a3b8" name="Target" />
                  <Bar dataKey="actual" fill="#10b981" name="Actual" />
                </BarChart>
              </ResponsiveContainer>

              {/* Department Details Table */}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="font-medium">Department</TableHead>
                      <TableHead className="text-center">Workers</TableHead>
                      <TableHead className="text-center">Processes</TableHead>
                      <TableHead className="text-right">Target</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead className="text-center">Efficiency</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {departmentData.map((dept: any) => (
                      <TableRow key={dept.deptId}>
                        <TableCell className="font-medium">
                          <div>
                            <p>{dept.deptName}</p>
                            {dept.deptCode && (
                              <p className="text-xs text-muted-foreground">{dept.deptCode}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">{dept.workerCount}</TableCell>
                        <TableCell className="text-center">{dept.processCount}</TableCell>
                        <TableCell className="text-right font-mono">{dept.totalTarget.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-mono">{dept.totalActual.toLocaleString()}</TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Progress 
                              value={Math.min(dept.efficiency, 100)} 
                              className="w-16 h-2" 
                            />
                            <Badge variant={getEfficiencyBadge(dept.efficiency)}>
                              {dept.efficiency.toFixed(1)}%
                            </Badge>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Process-wise Detailed Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Process-wise Productivity Details
            </span>
            <Badge variant="outline">
              {processData.length} Processes
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-4">Loading...</p>
          ) : processData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No process data available for the selected period</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-medium">Process</TableHead>
                    <TableHead className="text-center">Entries</TableHead>
                    <TableHead className="text-center">Workers</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-center">Efficiency</TableHead>
                    <TableHead>Departments</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processData.map((process: any) => (
                    <TableRow key={process.processId}>
                      <TableCell className="font-medium">
                        <div>
                          <p>{process.processName}</p>
                          {process.processCode && (
                            <p className="text-xs text-muted-foreground">{process.processCode}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary">{process.entryCount}</Badge>
                      </TableCell>
                      <TableCell className="text-center">{process.workerCount}</TableCell>
                      <TableCell className="text-right font-mono">{process.totalTarget.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{process.totalActual.toLocaleString()}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Progress 
                            value={Math.min(process.efficiency, 100)} 
                            className="w-16 h-2" 
                          />
                          <Badge variant={getEfficiencyBadge(process.efficiency)}>
                            {process.efficiency.toFixed(1)}%
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {process.departments.slice(0, 2).map((dept: string, idx: number) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {dept}
                            </Badge>
                          ))}
                          {process.departments.length > 2 && (
                            <Badge variant="outline" className="text-xs">
                              +{process.departments.length - 2}
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Process Efficiency Rankings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* Top Performing Processes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              Top Performing Processes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {processData
                .filter((p: any) => p.efficiency >= 80)
                .sort((a: any, b: any) => b.efficiency - a.efficiency)
                .slice(0, 5)
                .map((process: any, index: number) => (
                  <div key={process.processId} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold text-muted-foreground w-6">#{index + 1}</span>
                      <div>
                        <p className="font-medium text-sm">{process.processName}</p>
                        <p className="text-xs text-muted-foreground">
                          {process.totalActual.toLocaleString()} / {process.totalTarget.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <Badge variant={getEfficiencyBadge(process.efficiency)}>
                      {process.efficiency.toFixed(1)}%
                    </Badge>
                  </div>
                ))}
              {processData.filter((p: any) => p.efficiency >= 80).length === 0 && (
                <p className="text-sm text-muted-foreground">No high-performing processes</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Processes Needing Attention */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-red-500 rotate-180" />
              Processes Needing Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {processData
                .filter((p: any) => p.efficiency < 80)
                .sort((a: any, b: any) => a.efficiency - b.efficiency)
                .slice(0, 5)
                .map((process: any) => (
                  <div key={process.processId} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div>
                        <p className="font-medium text-sm">{process.processName}</p>
                        <p className="text-xs text-muted-foreground">
                          {process.totalActual.toLocaleString()} / {process.totalTarget.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Progress value={process.efficiency} className="w-16 h-2" />
                      <Badge variant="destructive">
                        {process.efficiency.toFixed(1)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              {processData.filter((p: any) => p.efficiency < 80).length === 0 && (
                <p className="text-sm text-muted-foreground">All processes performing well!</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
};

export default ProcessProductivityDashboard;
