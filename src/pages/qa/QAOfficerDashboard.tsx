import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardCheck, ClipboardList, CheckCircle2, XCircle, PauseCircle, Plus, Calendar, Search } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { format, startOfMonth, endOfMonth, subDays } from "date-fns";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid } from "recharts";

const RESULT_COLORS = { pass: "#22c55e", fail: "#ef4444", hold: "#f59e0b" };

export default function QAOfficerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [dateFilter, setDateFilter] = useState(format(new Date(), "yyyy-MM-dd"));
  const [monthFilter, setMonthFilter] = useState(format(new Date(), "yyyy-MM"));
  const [viewMode, setViewMode] = useState<"daily" | "monthly">("daily");
  const [searchTerm, setSearchTerm] = useState("");

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const monthStartStr = format(startOfMonth(new Date()), "yyyy-MM-dd");
  const trendStartStr = format(subDays(new Date(), 13), "yyyy-MM-dd");
  const statsFromStr = trendStartStr < monthStartStr ? trendStartStr : monthStartStr;

  // My inspections = ones I recorded or was the inspector on
  const myInspectionsFilter = `inspector_id.eq.${user?.id},created_by.eq.${user?.id}`;

  // Stats window: current month + the last 14 days (whichever reaches further back)
  const { data: statsRows = [] } = useQuery({
    queryKey: ["qa-officer-stats", user?.id, statsFromStr],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_inspections")
        .select("id, inspection_date, result")
        .or(myInspectionsFilter)
        .gte("inspection_date", statsFromStr)
        .lte("inspection_date", todayStr);
      if (error) throw error;
      return data;
    },
  });

  const monthRows = statsRows.filter((r: any) => r.inspection_date >= monthStartStr);
  const todayCount = statsRows.filter((r: any) => r.inspection_date === todayStr).length;
  const passCount = monthRows.filter((r: any) => r.result === "pass").length;
  const failCount = monthRows.filter((r: any) => r.result === "fail").length;
  const holdCount = monthRows.filter((r: any) => r.result === "hold").length;
  const passRate = monthRows.length > 0 ? Math.round((passCount / monthRows.length) * 100) : 0;

  // Last 14 days trend (pass / fail / hold per day)
  const trendData = Array.from({ length: 14 }, (_, i) => {
    const day = format(subDays(new Date(), 13 - i), "yyyy-MM-dd");
    const dayRows = statsRows.filter((r: any) => r.inspection_date === day);
    return {
      date: format(subDays(new Date(), 13 - i), "dd MMM"),
      Pass: dayRows.filter((r: any) => r.result === "pass").length,
      Fail: dayRows.filter((r: any) => r.result === "fail").length,
      Hold: dayRows.filter((r: any) => r.result === "hold").length,
    };
  });

  // My inspections list for the selected day / month
  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ["qa-officer-inspections", user?.id, viewMode, dateFilter, monthFilter],
    enabled: !!user?.id,
    queryFn: async () => {
      let query = supabase
        .from("qa_inspections")
        .select(`
          *,
          qa_processes(name, code),
          production_departments(name),
          grades(name)
        `)
        .or(myInspectionsFilter);

      if (viewMode === "daily") {
        query = query.eq("inspection_date", dateFilter);
      } else {
        const monthDate = new Date(monthFilter + "-01");
        query = query
          .gte("inspection_date", format(startOfMonth(monthDate), "yyyy-MM-dd"))
          .lte("inspection_date", format(endOfMonth(monthDate), "yyyy-MM-dd"));
      }

      const { data, error } = await query.order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const filteredInspections = inspections.filter((insp: any) =>
    insp.inspection_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    insp.qa_processes?.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    { key: "inspection_number", header: "Inspection #" },
    {
      key: "inspection_date",
      header: "Date",
      render: (row: any) => format(new Date(row.inspection_date), "dd MMM yyyy"),
    },
    {
      key: "qa_processes.name",
      header: "Process",
      render: (row: any) => row.qa_processes?.name || "-",
    },
    {
      key: "production_departments.name",
      header: "Department",
      render: (row: any) => row.production_departments?.name || "-",
    },
    {
      key: "grades.name",
      header: "Grade",
      render: (row: any) => row.grades?.name || "-",
    },
    { key: "shift", header: "Shift" },
    {
      key: "result",
      header: "Result",
      render: (row: any) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
          row.result === "pass" ? "bg-green-100 text-green-700" :
          row.result === "fail" ? "bg-red-100 text-red-700" :
          "bg-yellow-100 text-yellow-700"
        }`}>
          {row.result?.toUpperCase()}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <StatusBadge status={row.status} />,
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="My Inspections"
          description={`Inspection dashboard for ${user?.full_name || "QA Officer"}`}
          icon={ClipboardCheck}
          iconColor="text-green-500"
        >
          <Button onClick={() => navigate("/qa/inspections", { state: { openNewInspection: true } })}>
            <Plus className="h-4 w-4 mr-2" />
            New Inspection
          </Button>
        </PageHeader>

        {/* Metrics */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            title="Today's Inspections"
            value={todayCount}
            icon={ClipboardList}
            iconColor="text-blue-500"
          />
          <MetricCard
            title="This Month"
            value={monthRows.length}
            icon={ClipboardCheck}
            iconColor="text-green-500"
          />
          <MetricCard
            title="Pass Rate (Month)"
            value={`${passRate}%`}
            icon={CheckCircle2}
            iconColor="text-green-500"
            description={`${passCount} passed`}
          />
          <MetricCard
            title="Fails (Month)"
            value={failCount}
            icon={XCircle}
            iconColor="text-red-500"
          />
          <MetricCard
            title="Holds (Month)"
            value={holdCount}
            icon={PauseCircle}
            iconColor="text-yellow-500"
          />
        </div>

        {/* 14-day trend */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Inspections — Last 14 Days</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Pass" stackId="a" fill={RESULT_COLORS.pass} />
                  <Bar dataKey="Fail" stackId="a" fill={RESULT_COLORS.fail} />
                  <Bar dataKey="Hold" stackId="a" fill={RESULT_COLORS.hold} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
            <Button
              variant={viewMode === "daily" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("daily")}
            >
              Daily
            </Button>
            <Button
              variant={viewMode === "monthly" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("monthly")}
            >
              Monthly
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            {viewMode === "daily" ? (
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="w-40"
              />
            ) : (
              <Input
                type="month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="w-40"
              />
            )}
          </div>
          <div className="flex items-center gap-2 flex-1 max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search my inspections..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>

        <DataTable
          columns={columns}
          data={filteredInspections}
          emptyMessage={isLoading ? "Loading..." : "You have no inspections for this period."}
        />
      </div>
    </ERPLayout>
  );
}
