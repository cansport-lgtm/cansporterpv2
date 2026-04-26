import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { Wrench, AlertTriangle, Calendar, CheckCircle, Cog, IndianRupee, ArrowDownCircle } from "lucide-react";
import { format, startOfMonth, endOfMonth, subMonths, eachMonthOfInterval, addMonths } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface DashboardStats {
  totalWorkOrders: number;
  openWorkOrders: number;
  completedThisMonth: number;
  activeBreakdowns: number;
  overdueSchedules: number;
  lowStockParts: number;
  pendingDevTasks: number;
  totalMachines: number;
  sparePartsAddedCost: number;
  sparePartsConsumedCost: number;
}

interface WorkOrdersByType {
  type: string;
  count: number;
}

interface WorkOrdersByStatus {
  status: string;
  count: number;
}

interface MachinesByStatus {
  status: string;
  count: number;
}

interface MachinesByDepartment {
  department: string;
  operational: number;
  under_maintenance: number;
  breakdown: number;
  idle: number;
  total: number;
}

interface PMMonthlyData {
  month: string;
  scheduled: number;
  completed: number;
}

interface CompletedPMTask {
  id: string;
  title: string;
  machine: string;
  completedDate: string;
  performedBy: string;
}

const STATUS_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  in_progress: "#3b82f6",
  pending_approval: "#f59e0b",
  approved: "#22c55e",
  rejected: "#ef4444",
  closed: "#6b7280",
};

const MACHINE_STATUS_COLORS: Record<string, string> = {
  operational: "#22c55e",
  under_maintenance: "#f59e0b",
  breakdown: "#ef4444",
  idle: "#94a3b8",
  decommissioned: "#6b7280",
};

export default function MaintenanceDashboard() {
  const [stats, setStats] = useState<DashboardStats>({
    totalWorkOrders: 0,
    openWorkOrders: 0,
    completedThisMonth: 0,
    activeBreakdowns: 0,
    overdueSchedules: 0,
    lowStockParts: 0,
    pendingDevTasks: 0,
    totalMachines: 0,
    sparePartsAddedCost: 0,
    sparePartsConsumedCost: 0,
  });
  const [workOrdersByType, setWorkOrdersByType] = useState<WorkOrdersByType[]>([]);
  const [workOrdersByStatus, setWorkOrdersByStatus] = useState<WorkOrdersByStatus[]>([]);
  const [machinesByStatus, setMachinesByStatus] = useState<MachinesByStatus[]>([]);
  const [machinesByDepartment, setMachinesByDepartment] = useState<MachinesByDepartment[]>([]);
  const [pmMonthlyData, setPmMonthlyData] = useState<PMMonthlyData[]>([]);
  const [completedPMTasks, setCompletedPMTasks] = useState<CompletedPMTask[]>([]);
  const [loading, setLoading] = useState(true);
  
  // PM Trend filter state
  const [pmMonthsBack, setPmMonthsBack] = useState<number>(6);
  const [pmStartMonth, setPmStartMonth] = useState<Date>(subMonths(new Date(), 5));

  useEffect(() => {
    fetchDashboardData();
  }, [pmMonthsBack, pmStartMonth]);

  const fetchDashboardData = async () => {
    setLoading(true);
    try {
      const today = new Date();
      const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");

      // Get months for PM trend based on filter
      const pmEndMonth = addMonths(pmStartMonth, pmMonthsBack - 1);
      const months = eachMonthOfInterval({ start: startOfMonth(pmStartMonth), end: startOfMonth(pmEndMonth) });

      // Fetch work orders
      const { data: workOrders } = await supabase
        .from("maintenance_work_orders")
        .select("*, maintenance_types(name), machines(name), assigned_user:app_users!maintenance_work_orders_assigned_to_fkey(full_name)");

      // Fetch breakdowns
      const { data: breakdowns } = await supabase
        .from("breakdown_logs")
        .select("*")
        .in("status", ["draft", "in_progress"]);

      // Fetch all schedules for PM data
      const { data: allSchedules } = await supabase
        .from("maintenance_schedules")
        .select("*, machines(name)")
        .eq("is_active", true);

      // Fetch overdue schedules
      const { data: overdueSchedules } = await supabase
        .from("maintenance_schedules")
        .select("*")
        .lt("next_due_date", format(today, "yyyy-MM-dd"))
        .eq("is_active", true);

      // Fetch low stock parts
      const { data: lowStockParts } = await supabase
        .from("spare_parts")
        .select("*")
        .eq("is_active", true);

      // Fetch dev tasks
      const { data: devTasks } = await supabase
        .from("development_tasks")
        .select("*")
        .in("status", ["draft", "in_progress", "pending_approval"]);

      // Fetch machines with department info
      const { data: machines } = await supabase
        .from("machines")
        .select("*, production_departments(name)")
        .eq("is_active", true);

      // Fetch spare parts received this month (stock additions)
      const { data: sparePartsReceived } = await supabase
        .from("spare_parts")
        .select("current_stock, unit_cost")
        .eq("is_active", true);

      // Fetch spare parts consumed this month
      const { data: sparePartsIssued } = await supabase
        .from("spare_part_issues")
        .select("total_cost, issue_date")
        .gte("issue_date", monthStart)
        .lte("issue_date", monthEnd);

      // Calculate stats
      const openStatuses = ["draft", "in_progress", "pending_approval"];
      const openWOs = workOrders?.filter((wo) => openStatuses.includes(wo.status)) || [];
      const completedWOs = workOrders?.filter(
        (wo) => wo.status === "closed" && wo.completed_at && wo.completed_at >= monthStart
      ) || [];

      const lowStock = lowStockParts?.filter((p) => p.current_stock <= p.minimum_stock) || [];

      // Calculate spare parts costs
      const totalSparePartsCost = sparePartsReceived?.reduce((sum, part) => {
        return sum + ((part.current_stock || 0) * (part.unit_cost || 0));
      }, 0) || 0;

      const consumedCost = sparePartsIssued?.reduce((sum, issue) => {
        return sum + (issue.total_cost || 0);
      }, 0) || 0;

      setStats({
        totalWorkOrders: workOrders?.length || 0,
        openWorkOrders: openWOs.length,
        completedThisMonth: completedWOs.length,
        activeBreakdowns: breakdowns?.length || 0,
        overdueSchedules: overdueSchedules?.length || 0,
        lowStockParts: lowStock.length,
        pendingDevTasks: devTasks?.length || 0,
        totalMachines: machines?.length || 0,
        sparePartsAddedCost: totalSparePartsCost,
        sparePartsConsumedCost: consumedCost,
      });

      // Work orders by type
      const typeMap: Record<string, number> = {};
      workOrders?.forEach((wo) => {
        const typeName = wo.maintenance_types?.name || "Unassigned";
        typeMap[typeName] = (typeMap[typeName] || 0) + 1;
      });
      setWorkOrdersByType(Object.entries(typeMap).map(([type, count]) => ({ type, count })));

      // Work orders by status
      const statusMap: Record<string, number> = {};
      workOrders?.forEach((wo) => {
        statusMap[wo.status] = (statusMap[wo.status] || 0) + 1;
      });
      setWorkOrdersByStatus(Object.entries(statusMap).map(([status, count]) => ({ status, count })));

      // Machines by status
      const machineStatusMap: Record<string, number> = {};
      machines?.forEach((machine) => {
        const status = machine.status || "operational";
        machineStatusMap[status] = (machineStatusMap[status] || 0) + 1;
      });
      setMachinesByStatus(Object.entries(machineStatusMap).map(([status, count]) => ({ status, count })));

      // Machines by department
      const deptMap: Record<string, { operational: number; under_maintenance: number; breakdown: number; idle: number; total: number }> = {};
      machines?.forEach((machine: any) => {
        const deptName = machine.production_departments?.name || "Unassigned";
        const status = machine.status || "operational";
        if (!deptMap[deptName]) {
          deptMap[deptName] = { operational: 0, under_maintenance: 0, breakdown: 0, idle: 0, total: 0 };
        }
        if (status === "operational") deptMap[deptName].operational += 1;
        else if (status === "under_maintenance") deptMap[deptName].under_maintenance += 1;
        else if (status === "breakdown") deptMap[deptName].breakdown += 1;
        else if (status === "idle") deptMap[deptName].idle += 1;
        deptMap[deptName].total += 1;
      });
      setMachinesByDepartment(
        Object.entries(deptMap).map(([department, counts]) => ({
          department,
          ...counts,
        }))
      );

      // Calculate PM monthly data (scheduled vs completed)
      const pmData: PMMonthlyData[] = months.map((month) => {
        const monthStr = format(month, "MMM yy");
        const monthStartStr = format(startOfMonth(month), "yyyy-MM-dd");
        const monthEndStr = format(endOfMonth(month), "yyyy-MM-dd");

        // Count scheduled PMs for this month (schedules whose next_due_date falls in this month)
        const scheduledCount = allSchedules?.filter((s) => {
          const dueDate = s.next_due_date;
          return dueDate >= monthStartStr && dueDate <= monthEndStr;
        }).length || 0;

        // Count completed PMs - schedules whose last_performed_date falls in this month
        const completedCount = allSchedules?.filter((s) => {
          const performedDate = s.last_performed_date;
          return performedDate && performedDate >= monthStartStr && performedDate <= monthEndStr;
        }).length || 0;

        return { month: monthStr, scheduled: scheduledCount, completed: completedCount };
      });
      setPmMonthlyData(pmData);

      // Get recently completed PM tasks (last 10) - from schedules with last_performed_date
      const completedPMs = allSchedules
        ?.filter((s: any) => s.last_performed_date)
        .sort((a: any, b: any) => new Date(b.last_performed_date!).getTime() - new Date(a.last_performed_date!).getTime())
        .slice(0, 10)
        .map((s: any) => ({
          id: s.id,
          title: s.title,
          machine: s.machines?.name || "N/A",
          completedDate: s.last_performed_date ? format(new Date(s.last_performed_date), "dd MMM yyyy") : "-",
          performedBy: s.technician_name || "Unassigned",
        })) || [];
      setCompletedPMTasks(completedPMs);

    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const statCards = [
    { title: "Total Machines", value: stats.totalMachines, icon: Cog, color: "text-slate-500", bgColor: "bg-slate-500/10" },
    { title: "Open Work Orders", value: stats.openWorkOrders, icon: Wrench, color: "text-blue-500", bgColor: "bg-blue-500/10" },
    { title: "Active Breakdowns", value: stats.activeBreakdowns, icon: AlertTriangle, color: "text-red-500", bgColor: "bg-red-500/10" },
    { title: "Overdue PM", value: stats.overdueSchedules, icon: Calendar, color: "text-amber-500", bgColor: "bg-amber-500/10" },
    { title: "Total Spare Parts Stock", value: formatCurrency(stats.sparePartsAddedCost), icon: IndianRupee, color: "text-emerald-500", bgColor: "bg-emerald-500/10" },
    { title: "Consumed This Month", value: formatCurrency(stats.sparePartsConsumedCost), icon: ArrowDownCircle, color: "text-orange-500", bgColor: "bg-orange-500/10" },
  ];

  const formatMachineStatus = (status: string) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  };

  return (
    <ERPLayout>
      <PageHeader title="Maintenance Dashboard" description="Overview of maintenance activities and KPIs" />

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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Machine Status Pie Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Machine Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              {machinesByStatus.length === 0 ? (
                <div className="h-full flex items-center justify-center text-muted-foreground">
                  No machines found
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={machinesByStatus}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      label={({ count }) => count}
                      labelLine={false}
                    >
                      {machinesByStatus.map((entry) => (
                        <Cell key={entry.status} fill={MACHINE_STATUS_COLORS[entry.status] || "#8884d8"} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [value, formatMachineStatus(name as string)]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "8px",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            {/* Machine Status Summary */}
            {machinesByStatus.length > 0 && (
              <div className="mt-4 space-y-2 border-t pt-4">
                {machinesByStatus.map((entry) => (
                  <div key={entry.status} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded-full" 
                        style={{ backgroundColor: MACHINE_STATUS_COLORS[entry.status] || "#8884d8" }}
                      />
                      <span className="text-muted-foreground">{formatMachineStatus(entry.status)}</span>
                    </div>
                    <span className="font-medium">{entry.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Work Orders by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work Orders by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workOrdersByType} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" />
                  <YAxis dataKey="type" type="category" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Work Orders by Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Work Orders by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={workOrdersByStatus}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={70}
                    label={({ status, count }) => `${status}: ${count}`}
                  >
                    {workOrdersByStatus.map((entry) => (
                      <Cell key={entry.status} fill={STATUS_COLORS[entry.status] || "#8884d8"} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Department-wise Machine Status */}
      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Department-wise Machine Status</CardTitle>
        </CardHeader>
        <CardContent>
          {machinesByDepartment.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground">
              No department data available
            </div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={machinesByDepartment} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" />
                  <YAxis 
                    dataKey="department" 
                    type="category" 
                    width={120} 
                    tick={{ fontSize: 12 }} 
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar dataKey="operational" stackId="a" fill={MACHINE_STATUS_COLORS.operational} name="Operational" />
                  <Bar dataKey="under_maintenance" stackId="a" fill={MACHINE_STATUS_COLORS.under_maintenance} name="Under Maintenance" />
                  <Bar dataKey="breakdown" stackId="a" fill={MACHINE_STATUS_COLORS.breakdown} name="Breakdown" />
                  <Bar dataKey="idle" stackId="a" fill={MACHINE_STATUS_COLORS.idle} name="Idle" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Legend */}
          {machinesByDepartment.length > 0 && (
            <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t justify-center">
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MACHINE_STATUS_COLORS.operational }} />
                <span>Operational</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MACHINE_STATUS_COLORS.under_maintenance }} />
                <span>Under Maintenance</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MACHINE_STATUS_COLORS.breakdown }} />
                <span>Breakdown</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MACHINE_STATUS_COLORS.idle }} />
                <span>Idle</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Preventive Maintenance Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        {/* PM Trend Chart */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                Preventive Maintenance Trend
              </CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={format(pmStartMonth, "yyyy-MM")}
                  onValueChange={(value) => setPmStartMonth(new Date(value + "-01"))}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue placeholder="Start Month" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 24 }, (_, i) => {
                      const month = subMonths(new Date(), i);
                      return (
                        <SelectItem key={i} value={format(month, "yyyy-MM")}>
                          {format(month, "MMM yyyy")}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Select
                  value={pmMonthsBack.toString()}
                  onValueChange={(value) => setPmMonthsBack(parseInt(value))}
                >
                  <SelectTrigger className="w-[100px] h-8 text-xs">
                    <SelectValue placeholder="Duration" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3">3 Months</SelectItem>
                    <SelectItem value="6">6 Months</SelectItem>
                    <SelectItem value="12">12 Months</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {pmMonthlyData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No PM data available
              </div>
            ) : (
              <div className="h-64">
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
                    <Bar dataKey="scheduled" fill="#f59e0b" name="Scheduled" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" fill="#22c55e" name="Completed" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Completed PM Tasks Table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              Recently Completed PM Tasks
            </CardTitle>
          </CardHeader>
          <CardContent>
            {completedPMTasks.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                No completed PM tasks found
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium">Task</th>
                      <th className="text-left p-2 font-medium">Machine</th>
                      <th className="text-left p-2 font-medium">Completed</th>
                      <th className="text-left p-2 font-medium">By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedPMTasks.map((task) => (
                      <tr key={task.id} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-2 max-w-[150px] truncate" title={task.title}>{task.title}</td>
                        <td className="p-2">{task.machine}</td>
                        <td className="p-2 text-muted-foreground">{task.completedDate}</td>
                        <td className="p-2">{task.performedBy}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
