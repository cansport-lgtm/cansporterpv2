import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";
import { Tags, Users, TrendingUp, Target, CalendarIcon, BarChart3 } from "lucide-react";
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

const CategoryProductivityDashboard = () => {
  const [dateRange, setDateRange] = useState("today");
  const [selectedDepartment, setSelectedDepartment] = useState("all");
  const [selectedCategory, setSelectedCategory] = useState("all");
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

  const { data: categories = [] } = useQuery({
    queryKey: ["labour-categories-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_categories")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: productivityData = [] } = useQuery({
    queryKey: ["category-productivity", dateRange, selectedDepartment, selectedCategory, customDate?.toISOString()],
    queryFn: async () => {
      const { start, end } = getDateFilter();
      let query = supabase
        .from("labour_productivity_targets")
        .select(`
          *,
          labour_employees(id, full_name, employee_code, category),
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

      // Filter by category client-side since it's on labour_employees
      if (selectedCategory !== "all") {
        return (data || []).filter((d: any) => d.labour_employees?.category === selectedCategory);
      }
      return data || [];
    },
  });

  // Aggregate by category
  const categoryStats = productivityData.reduce((acc: any, entry: any) => {
    const cat = entry.labour_employees?.category || "Uncategorized";

    if (!acc[cat]) {
      acc[cat] = {
        category: cat,
        totalTarget: 0,
        totalActual: 0,
        entryCount: 0,
        workers: new Set(),
        departments: new Set(),
        totalMph: 0,
        entries: [],
      };
    }

    acc[cat].totalTarget += entry.target_quantity || 0;
    acc[cat].totalActual += entry.actual_quantity || 0;
    acc[cat].entryCount += 1;
    acc[cat].workers.add(entry.employee_id);
    acc[cat].totalMph += Number(entry.mph || 0);
    if (entry.production_departments?.name) {
      acc[cat].departments.add(entry.production_departments.name);
    }
    acc[cat].entries.push({
      id: entry.id,
      empName: entry.labour_employees?.full_name || "Unknown",
      empCode: entry.labour_employees?.employee_code || "",
      department: entry.production_departments?.name || "-",
      process: entry.qa_processes?.name || "-",
      workType: entry.work_type === "full_day" ? "Full Day" : "Half Day",
      mph: Number(entry.mph || 0),
      target: entry.target_quantity || 0,
      actual: entry.actual_quantity || 0,
      efficiency: Number(entry.efficiency_percentage || 0),
    });

    return acc;
  }, {} as Record<string, any>);

  const categoryData = Object.values(categoryStats)
    .map((c: any) => ({
      ...c,
      workerCount: c.workers.size,
      departmentCount: c.departments.size,
      departments: Array.from(c.departments),
      efficiency: c.totalTarget > 0 ? (c.totalActual / c.totalTarget) * 100 : 0,
    }))
    .sort((a: any, b: any) => b.totalActual - a.totalActual);

  // Chart data
  const barChartData = categoryData.map((c: any) => ({
    name: c.category.length > 15 ? c.category.substring(0, 15) + "..." : c.category,
    fullName: c.category,
    target: c.totalTarget,
    actual: c.totalActual,
    efficiency: Math.round(c.efficiency),
  }));

  const pieData = categoryData.slice(0, 8).map((c: any, i: number) => ({
    name: c.category,
    value: c.workerCount,
    color: COLORS[i % COLORS.length],
  }));

  // Summary metrics
  const totalCategories = categoryData.length;
  const totalWorkers = new Set(productivityData.map((d: any) => d.employee_id)).size;
  const totalTarget = categoryData.reduce((s: number, c: any) => s + c.totalTarget, 0);
  const totalActual = categoryData.reduce((s: number, c: any) => s + c.totalActual, 0);
  const overallEfficiency = totalTarget > 0 ? (totalActual / totalTarget) * 100 : 0;

  const getEfficiencyBadge = (efficiency: number) => {
    if (efficiency >= 100) return "default";
    if (efficiency >= 80) return "secondary";
    return "destructive";
  };

  return (
    <ERPLayout>
      <PageHeader
        title="Category-wise Labour Dashboard"
        description="Analyze labour productivity grouped by employee category"
        icon={Tags}
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

        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.name}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          title="Active Categories"
          value={totalCategories.toString()}
          icon={Tags}
        />
        <MetricCard
          title="Total Workers"
          value={totalWorkers.toString()}
          icon={Users}
        />
        <MetricCard
          title="Total Achieved"
          value={totalActual.toLocaleString()}
          icon={Target}
        />
        <MetricCard
          title="Overall Efficiency"
          value={`${overallEfficiency.toFixed(1)}%`}
          icon={TrendingUp}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Category Performance - Target vs Actual
            </CardTitle>
          </CardHeader>
          <CardContent>
            {barChartData.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No data available</p>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={barChartData} layout="vertical" margin={{ left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={120} fontSize={11} />
                  <Tooltip
                    formatter={(value: any, name: string) => [value.toLocaleString(), name]}
                    labelFormatter={(label) => barChartData.find((d) => d.name === label)?.fullName || label}
                  />
                  <Legend />
                  <Bar dataKey="target" fill="#94a3b8" name="Target" />
                  <Bar dataKey="actual" fill="#3b82f6" name="Actual" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4" />
              Worker Distribution by Category
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
                    label={({ name, value }) => `${name} (${value})`}
                    outerRadius={120}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </RechartsPie>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Category Summary Table */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Tags className="h-4 w-4" />
            Category-wise Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {categoryData.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No data available</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-medium">Category</TableHead>
                    <TableHead className="text-center">Workers</TableHead>
                    <TableHead className="text-center">Depts</TableHead>
                    <TableHead className="text-right">Target</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    <TableHead className="text-right">MPH</TableHead>
                    <TableHead className="text-center">Efficiency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryData.map((cat: any) => (
                    <TableRow key={cat.category}>
                      <TableCell className="font-medium">{cat.category}</TableCell>
                      <TableCell className="text-center">{cat.workerCount}</TableCell>
                      <TableCell className="text-center">{cat.departmentCount}</TableCell>
                      <TableCell className="text-right font-mono">{cat.totalTarget.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{cat.totalActual.toLocaleString()}</TableCell>
                      <TableCell className="text-right font-mono">{cat.totalMph}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Progress value={Math.min(cat.efficiency, 100)} className="w-16 h-2" />
                          <Badge variant={getEfficiencyBadge(cat.efficiency)}>
                            {cat.efficiency.toFixed(1)}%
                          </Badge>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals row */}
                  <TableRow className="bg-muted/50 font-semibold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-center">{totalWorkers}</TableCell>
                    <TableCell className="text-center">-</TableCell>
                    <TableCell className="text-right font-mono">{totalTarget.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">{totalActual.toLocaleString()}</TableCell>
                    <TableCell className="text-right font-mono">
                      {categoryData.reduce((s: number, c: any) => s + c.totalMph, 0)}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={getEfficiencyBadge(overallEfficiency)}>
                        {overallEfficiency.toFixed(1)}%
                      </Badge>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detailed Breakdown per Category */}
      {categoryData.map((cat: any) => (
        <Card key={cat.category} className="mb-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Tags className="h-4 w-4" />
                {cat.category}
              </span>
              <div className="flex gap-2">
                <Badge variant="secondary">{cat.workerCount} Workers</Badge>
                <Badge variant="outline">{cat.totalMph} MPH</Badge>
                <Badge variant={getEfficiencyBadge(cat.efficiency)}>
                  {cat.efficiency.toFixed(1)}% Eff
                </Badge>
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="text-left p-2 font-medium">Employee</th>
                    <th className="text-left p-2 font-medium">Department</th>
                    <th className="text-left p-2 font-medium">Process</th>
                    <th className="text-center p-2 font-medium">Work Type</th>
                    <th className="text-right p-2 font-medium">MPH</th>
                    <th className="text-right p-2 font-medium">Target</th>
                    <th className="text-right p-2 font-medium">Actual</th>
                    <th className="text-center p-2 font-medium">Efficiency</th>
                  </tr>
                </thead>
                <tbody>
                  {cat.entries.map((entry: any) => (
                    <tr key={entry.id} className="border-b hover:bg-muted/30">
                      <td className="p-2">
                        <div>
                          <p className="font-medium">{entry.empName}</p>
                          <p className="text-xs text-muted-foreground">{entry.empCode}</p>
                        </div>
                      </td>
                      <td className="p-2">{entry.department}</td>
                      <td className="p-2">{entry.process}</td>
                      <td className="p-2 text-center">
                        <Badge variant="outline" className="text-xs">{entry.workType}</Badge>
                      </td>
                      <td className="p-2 text-right font-mono">{entry.mph}</td>
                      <td className="p-2 text-right font-mono">{entry.target}</td>
                      <td className="p-2 text-right font-mono">{entry.actual}</td>
                      <td className="p-2 text-center">
                        <Badge variant={getEfficiencyBadge(entry.efficiency)}>
                          {entry.efficiency.toFixed(1)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ))}
    </ERPLayout>
  );
};

export default CategoryProductivityDashboard;
