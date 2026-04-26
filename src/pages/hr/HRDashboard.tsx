import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Calendar, FileCheck, Briefcase, Clock, UserCheck, DollarSign } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { DataTable } from "@/components/shared/DataTable";

const COLORS = ["#22c55e", "#ef4444", "#f59e0b", "#3b82f6", "#8b5cf6"];
const ATTENDANCE_COLORS = {
  present: "#22c55e",
  absent: "#ef4444",
  half_day: "#f59e0b",
  late: "#3b82f6",
  on_leave: "#8b5cf6",
};

export default function HRDashboard() {
  const today = new Date();
  const monthStart = format(startOfMonth(today), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(today), "yyyy-MM-dd");
  const todayStr = format(today, "yyyy-MM-dd");

  // Fetch employee count
  const { data: employeeStats } = useQuery({
    queryKey: ["hr-employee-stats"],
    queryFn: async () => {
      const { data: employees } = await supabase
        .from("employees")
        .select("id, is_active");
      
      const total = employees?.length || 0;
      const active = employees?.filter(e => e.is_active).length || 0;
      return { total, active };
    },
  });

  // Fetch today's attendance
  const { data: attendanceStats } = useQuery({
    queryKey: ["hr-attendance-today", todayStr],
    queryFn: async () => {
      const { data } = await supabase
        .from("attendance")
        .select("status")
        .eq("attendance_date", todayStr);
      
      const stats: Record<string, number> = {
        present: 0,
        absent: 0,
        half_day: 0,
        late: 0,
        on_leave: 0,
      };
      
      data?.forEach(a => {
        if (stats[a.status] !== undefined) {
          stats[a.status]++;
        }
      });
      
      return stats;
    },
  });

  // Fetch leave requests stats
  const { data: leaveStats } = useQuery({
    queryKey: ["hr-leave-stats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("status");
      
      const pending = data?.filter(l => l.status === "pending").length || 0;
      const approved = data?.filter(l => l.status === "approved").length || 0;
      return { pending, approved, total: data?.length || 0 };
    },
  });

  // Fetch open job postings
  const { data: jobStats } = useQuery({
    queryKey: ["hr-job-stats"],
    queryFn: async () => {
      const { data: jobs } = await supabase
        .from("job_postings")
        .select("id, status, positions");
      
      const open = jobs?.filter(j => j.status === "open") || [];
      const openPositions = open.reduce((sum, j) => sum + (j.positions || 0), 0);
      
      const { data: candidates } = await supabase
        .from("job_candidates")
        .select("status");
      
      const newApplications = candidates?.filter(c => c.status === "applied").length || 0;
      
      return { openJobs: open.length, openPositions, newApplications };
    },
  });

  // Fetch loan stats
  const { data: loanStats } = useQuery({
    queryKey: ["hr-loan-stats"],
    queryFn: async () => {
      const { data } = await supabase
        .from("employee_loans")
        .select("loan_amount, remaining_amount, status, employee_id, employees(employee_code, full_name)")
        .in("status", ["approved", "active"]);
      
      const totalOutstanding = data?.reduce((sum, l) => sum + Number(l.remaining_amount), 0) || 0;
      const totalLoaned = data?.reduce((sum, l) => sum + Number(l.loan_amount), 0) || 0;
      const activeLoans = data?.length || 0;
      
      // Top 5 employees with loans
      const employeeLoans = data?.map(l => ({
        id: l.employee_id,
        name: l.employees?.full_name || "Unknown",
        code: l.employees?.employee_code || "",
        outstanding: Number(l.remaining_amount),
        total: Number(l.loan_amount),
      })) || [];
      
      return { totalOutstanding, totalLoaned, activeLoans, employeeLoans };
    },
  });

  // Attendance distribution for pie chart
  const attendanceChartData = attendanceStats
    ? Object.entries(attendanceStats)
        .filter(([_, value]) => value > 0)
        .map(([key, value]) => ({
          name: key.replace("_", " ").replace(/\b\w/g, l => l.toUpperCase()),
          value,
          color: ATTENDANCE_COLORS[key as keyof typeof ATTENDANCE_COLORS],
        }))
    : [];

  // Monthly leave trends
  const { data: monthlyLeaves } = useQuery({
    queryKey: ["hr-monthly-leaves", monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("leave_type_id, total_days, leave_types(name)")
        .gte("start_date", monthStart)
        .lte("end_date", monthEnd)
        .eq("status", "approved");
      
      const byType: Record<string, number> = {};
      data?.forEach((l: any) => {
        const name = l.leave_types?.name || "Other";
        byType[name] = (byType[name] || 0) + Number(l.total_days);
      });
      
      return Object.entries(byType).map(([name, days]) => ({ name, days }));
    },
  });

  interface LoanItem {
    id: string;
    name: string;
    code: string;
    outstanding: number;
    total: number;
  }

  const loanColumns = [
    {
      key: "name",
      header: "Employee",
      render: (item: LoanItem) => (
        <div>
          <div className="font-medium">{item.name}</div>
          <div className="text-xs text-muted-foreground">{item.code}</div>
        </div>
      ),
    },
    {
      key: "outstanding",
      header: "Outstanding",
      render: (item: LoanItem) => (
        <span className="font-medium text-destructive">Rs. {item.outstanding.toLocaleString()}</span>
      ),
    },
    {
      key: "total",
      header: "Total Loan",
      render: (item: LoanItem) => `Rs. ${item.total.toLocaleString()}`,
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="HR Dashboard"
          description="Overview of workforce and recruitment"
        />

        {/* Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard
            title="Total Employees"
            value={employeeStats?.total || 0}
            description={`${employeeStats?.active || 0} active`}
            icon={Users}
          />
          <MetricCard
            title="Present Today"
            value={attendanceStats?.present || 0}
            description={`${attendanceStats?.late || 0} late`}
            icon={UserCheck}
            trend={attendanceStats ? { value: Math.round((attendanceStats.present / (employeeStats?.active || 1)) * 100), isPositive: true } : undefined}
          />
          <MetricCard
            title="Pending Leaves"
            value={leaveStats?.pending || 0}
            description={`${leaveStats?.approved || 0} approved this month`}
            icon={Calendar}
          />
          <MetricCard
            title="Open Positions"
            value={jobStats?.openPositions || 0}
            description={`${jobStats?.newApplications || 0} new applications`}
            icon={Briefcase}
          />
          <MetricCard
            title="Loans Outstanding"
            value={`Rs. ${(loanStats?.totalOutstanding || 0).toLocaleString()}`}
            description={`${loanStats?.activeLoans || 0} active loans`}
            icon={DollarSign}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Today's Attendance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Today's Attendance
              </CardTitle>
            </CardHeader>
            <CardContent>
              {attendanceChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={attendanceChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={3}
                      dataKey="value"
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {attendanceChartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  No attendance data for today
                </div>
              )}
            </CardContent>
          </Card>

          {/* Monthly Leave Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileCheck className="h-5 w-5" />
                Monthly Leave Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              {monthlyLeaves && monthlyLeaves.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={monthlyLeaves}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" fontSize={12} />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="days" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                  No approved leaves this month
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Employee Loans Section */}
        {loanStats?.employeeLoans && loanStats.employeeLoans.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Active Employee Loans
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable
                columns={loanColumns}
                data={loanStats.employeeLoans}
                emptyMessage="No active loans"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </ERPLayout>
  );
}
