import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, CheckCircle, Clock, AlertTriangle, TrendingUp, Wrench, ChevronDown, ChevronUp } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval, addMonths, isToday, isYesterday, isSameDay, isSameMonth } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface PMSchedule {
  id: string;
  schedule_number: string;
  title: string;
  description: string | null;
  instructions: string | null;
  machine_id: string | null;
  technician_name: string | null;
  frequency_days: number;
  last_performed_date: string | null;
  next_due_date: string;
  priority: string;
  machines?: { name: string; code: string } | null;
  maintenance_types?: { name: string } | null;
}

interface PMMonthlyData {
  month: string;
  scheduled: number;
  completed: number;
}

interface PMStats {
  totalSchedules: number;
  overdueCount: number;
  dueSoonCount: number;
  completedToday: number;
  completedThisMonth: number;
  inProgress: number;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: "#94a3b8",
  medium: "#3b82f6",
  high: "#f59e0b",
  critical: "#ef4444",
};

export default function PMDashboard() {
  const navigate = useNavigate();
  const [schedules, setSchedules] = useState<PMSchedule[]>([]);
  const [stats, setStats] = useState<PMStats>({
    totalSchedules: 0,
    overdueCount: 0,
    dueSoonCount: 0,
    completedToday: 0,
    completedThisMonth: 0,
    inProgress: 0,
  });
  const [pmMonthlyData, setPmMonthlyData] = useState<PMMonthlyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Filters
  const [pmMonthsBack, setPmMonthsBack] = useState<number>(6);
  const [pmStartMonth, setPmStartMonth] = useState<Date>(subMonths(new Date(), 5));
  const [completedFilter, setCompletedFilter] = useState<"all" | "today" | "yesterday" | "date" | "month">("all");
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedMonth, setSelectedMonth] = useState<Date | undefined>(undefined);
  const [technicianFilter, setTechnicianFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");

  // Extract unique technicians and machines from schedules
  const uniqueTechnicians = Array.from(
    new Set(schedules.filter((s) => s.technician_name).map((s) => s.technician_name!))
  ).sort();
  const uniqueMachines = Array.from(
    new Set(
      schedules
        .filter((s) => s.machines?.name)
        .map((s) => JSON.stringify({ id: s.machine_id, name: s.machines!.name }))
    )
  ).map((s) => JSON.parse(s) as { id: string; name: string }).sort((a, b) => a.name.localeCompare(b.name));

  const toggleRowExpansion = (id: string) => {
    setExpandedRows((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  useEffect(() => {
    fetchData();
  }, [pmMonthsBack, pmStartMonth]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const todayStr = format(today, "yyyy-MM-dd");
      const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");

      // Fetch all schedules
      const { data: allSchedules } = await supabase
        .from("maintenance_schedules")
        .select("*, machines(name, code), maintenance_types(name)")
        .eq("is_active", true)
        .order("next_due_date");

      if (allSchedules) {
        setSchedules(allSchedules);

        // Calculate stats
        const overdue = allSchedules.filter((s) => s.next_due_date < todayStr && !s.last_performed_date);
        const dueSoon = allSchedules.filter((s) => {
          const dueDate = new Date(s.next_due_date);
          const sevenDaysFromNow = new Date();
          sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
          return s.next_due_date >= todayStr && dueDate <= sevenDaysFromNow;
        });
        const completedToday = allSchedules.filter((s) => s.last_performed_date === todayStr);
        const completedThisMonth = allSchedules.filter(
          (s) => s.last_performed_date && s.last_performed_date >= monthStart && s.last_performed_date <= monthEnd
        );
        const inProgress = allSchedules.filter((s) => !s.last_performed_date);

        setStats({
          totalSchedules: allSchedules.length,
          overdueCount: overdue.length,
          dueSoonCount: dueSoon.length,
          completedToday: completedToday.length,
          completedThisMonth: completedThisMonth.length,
          inProgress: inProgress.length,
        });

        // Calculate PM monthly trend data
        const pmEndMonth = addMonths(pmStartMonth, pmMonthsBack - 1);
        const months = eachMonthOfInterval({ start: startOfMonth(pmStartMonth), end: startOfMonth(pmEndMonth) });

        const pmData: PMMonthlyData[] = months.map((month) => {
          const monthStr = format(month, "MMM yy");
          const monthStartStr = format(startOfMonth(month), "yyyy-MM-dd");
          const monthEndStr = format(endOfMonth(month), "yyyy-MM-dd");

          // Count scheduled PMs for this month
          const scheduledCount = allSchedules.filter((s) => {
            const dueDate = s.next_due_date;
            return dueDate >= monthStartStr && dueDate <= monthEndStr;
          }).length;

          // Count completed PMs
          const completedCount = allSchedules.filter((s) => {
            const performedDate = s.last_performed_date;
            return performedDate && performedDate >= monthStartStr && performedDate <= monthEndStr;
          }).length;

          return { month: monthStr, scheduled: scheduledCount, completed: completedCount };
        });
        setPmMonthlyData(pmData);
      }
    } catch (error) {
      console.error("Error fetching PM data:", error);
    } finally {
      setLoading(false);
    }
  };

  // Filter completed schedules based on selected filter
  const getFilteredCompletedSchedules = () => {
    return schedules.filter((s) => {
      if (!s.last_performed_date) return false;
      const performedDate = new Date(s.last_performed_date);

      // Date filter
      let dateMatch = true;
      if (completedFilter === "today") {
        dateMatch = isToday(performedDate);
      } else if (completedFilter === "yesterday") {
        dateMatch = isYesterday(performedDate);
      } else if (completedFilter === "date" && selectedDate) {
        dateMatch = isSameDay(performedDate, selectedDate);
      } else if (completedFilter === "month" && selectedMonth) {
        dateMatch = isSameMonth(performedDate, selectedMonth);
      }

      // Technician filter
      const techMatch = technicianFilter === "all" || s.technician_name === technicianFilter;

      // Machine filter
      const machineMatch = machineFilter === "all" || s.machine_id === machineFilter;

      return dateMatch && techMatch && machineMatch;
    });
  };

  const filteredCompletedSchedules = getFilteredCompletedSchedules();

  // Priority distribution for pie chart
  const priorityDistribution = schedules.reduce((acc, s) => {
    acc[s.priority] = (acc[s.priority] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const priorityData = Object.entries(priorityDistribution).map(([priority, count]) => ({
    priority,
    count,
  }));

  const statCards = [
    { title: "Total Schedules", value: stats.totalSchedules, icon: Calendar, color: "text-blue-500", bgColor: "bg-blue-500/10" },
    { title: "In Progress", value: stats.inProgress, icon: Clock, color: "text-amber-500", bgColor: "bg-amber-500/10" },
    { title: "Overdue", value: stats.overdueCount, icon: AlertTriangle, color: "text-red-500", bgColor: "bg-red-500/10" },
    { title: "Due Soon (7d)", value: stats.dueSoonCount, icon: TrendingUp, color: "text-orange-500", bgColor: "bg-orange-500/10" },
    { title: "Completed Today", value: stats.completedToday, icon: CheckCircle, color: "text-green-500", bgColor: "bg-green-500/10" },
    { title: "Completed This Month", value: stats.completedThisMonth, icon: Wrench, color: "text-purple-500", bgColor: "bg-purple-500/10" },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Preventive Maintenance Dashboard"
        description="Overview of PM schedules, trends, and completion status"
        action={{
          label: "View PM Schedule",
          onClick: () => navigate("/maintenance/pm-schedule"),
        }}
      />

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {statCards.map((stat) => (
          <Card key={stat.title} className="border-border/50">
            <CardContent className="p-4">
              <div className={`w-10 h-10 rounded-lg ${stat.bgColor} flex items-center justify-center mb-3`}>
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <p className="text-2xl font-bold">{loading ? "-" : stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.title}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* PM Trend Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Preventive Maintenance Trend</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={pmMonthsBack.toString()} onValueChange={(v) => setPmMonthsBack(parseInt(v))}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3 Months</SelectItem>
                  <SelectItem value="6">6 Months</SelectItem>
                  <SelectItem value="12">12 Months</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPmStartMonth((prev) => subMonths(prev, 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                  {format(pmStartMonth, "MMM yy")}
                </span>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setPmStartMonth((prev) => addMonths(prev, 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={pmMonthlyData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Legend />
                  <Bar dataKey="scheduled" name="Scheduled" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Priority Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By Priority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={priorityData}
                    dataKey="count"
                    nameKey="priority"
                    cx="50%"
                    cy="50%"
                    outerRadius={60}
                    label={({ count }) => count}
                    labelLine={false}
                  >
                    {priorityData.map((entry) => (
                      <Cell key={entry.priority} fill={PRIORITY_COLORS[entry.priority] || "#8884d8"} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value, name) => [value, (name as string).toUpperCase()]}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 space-y-2 border-t pt-4">
              {priorityData.map((entry) => (
                <div key={entry.priority} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: PRIORITY_COLORS[entry.priority] || "#8884d8" }}
                    />
                    <span className="text-muted-foreground capitalize">{entry.priority}</span>
                  </div>
                  <span className="font-medium">{entry.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recently Completed PM Tasks */}
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-row items-center justify-between flex-wrap gap-4">
            <CardTitle className="text-base">Completed PM Tasks</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Select
                value={completedFilter}
                onValueChange={(v: "all" | "today" | "yesterday" | "date" | "month") => {
                  setCompletedFilter(v);
                  if (v !== "date") setSelectedDate(undefined);
                  if (v !== "month") setSelectedMonth(undefined);
                }}
              >
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="date">Select Date</SelectItem>
                  <SelectItem value="month">Select Month</SelectItem>
                </SelectContent>
              </Select>

              {completedFilter === "date" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[140px] justify-start text-left font-normal",
                        !selectedDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedDate ? format(selectedDate, "dd-MMM-yyyy") : "Pick date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={selectedDate}
                      onSelect={setSelectedDate}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}

              {completedFilter === "month" && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-[140px] justify-start text-left font-normal",
                        !selectedMonth && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {selectedMonth ? format(selectedMonth, "MMMM yyyy") : "Pick month"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      mode="single"
                      selected={selectedMonth}
                      onSelect={setSelectedMonth}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
          
          {/* Technician and Machine Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={machineFilter} onValueChange={setMachineFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Machines" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Machines</SelectItem>
                {uniqueMachines.map((machine) => (
                  <SelectItem key={machine.id} value={machine.id}>
                    {machine.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={technicianFilter} onValueChange={setTechnicianFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Technicians" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Technicians</SelectItem>
                {uniqueTechnicians.map((tech) => (
                  <SelectItem key={tech} value={tech}>
                    {tech}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {(machineFilter !== "all" || technicianFilter !== "all") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setMachineFilter("all");
                  setTechnicianFilter("all");
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {filteredCompletedSchedules.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No completed tasks found for the selected filter
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="w-8 py-3 px-2"></th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Schedule #</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Title</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Machine</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Completed</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Technician</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompletedSchedules.slice(0, 15).map((schedule) => {
                    const isExpanded = expandedRows.has(schedule.id);
                    const hasDetails = schedule.description || schedule.instructions;
                    return (
                      <>
                        <tr 
                          key={schedule.id} 
                          className={cn(
                            "border-b border-border/50 hover:bg-muted/50",
                            hasDetails && "cursor-pointer"
                          )}
                          onClick={() => hasDetails && toggleRowExpansion(schedule.id)}
                        >
                          <td className="py-3 px-2">
                            {hasDetails && (
                              <button className="p-1 hover:bg-muted rounded">
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-muted-foreground" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                )}
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-2 font-mono text-xs">{schedule.schedule_number}</td>
                          <td className="py-3 px-2">{schedule.title}</td>
                          <td className="py-3 px-2">{schedule.machines?.name || "-"}</td>
                          <td className="py-3 px-2">
                            {schedule.last_performed_date
                              ? format(new Date(schedule.last_performed_date), "dd-MMM-yyyy")
                              : "-"}
                          </td>
                          <td className="py-3 px-2">{schedule.technician_name || "-"}</td>
                          <td className="py-3 px-2">
                            <Badge
                              className="text-white"
                              style={{ backgroundColor: PRIORITY_COLORS[schedule.priority] || "#94a3b8" }}
                            >
                              {schedule.priority.toUpperCase()}
                            </Badge>
                          </td>
                        </tr>
                        {isExpanded && hasDetails && (
                          <tr key={`${schedule.id}-details`} className="bg-muted/30">
                            <td colSpan={7} className="py-3 px-4">
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                                {schedule.technician_name && (
                                  <div>
                                    <span className="font-medium text-muted-foreground">Technician:</span>
                                    <p className="mt-1">{schedule.technician_name}</p>
                                  </div>
                                )}
                                {schedule.description && (
                                  <div>
                                    <span className="font-medium text-muted-foreground">Description:</span>
                                    <p className="mt-1 whitespace-pre-wrap">{schedule.description}</p>
                                  </div>
                                )}
                                {schedule.instructions && (
                                  <div>
                                    <span className="font-medium text-muted-foreground">Instructions:</span>
                                    <p className="mt-1 whitespace-pre-wrap">{schedule.instructions}</p>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
