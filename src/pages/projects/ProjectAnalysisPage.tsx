import { useEffect, useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  BarChart3,
  Briefcase,
  Clock,
  CheckCircle,
  AlertTriangle,
  ListTodo,
  Wallet,
  Users,
  Lightbulb,
  ArrowLeft,
  Flag,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format, differenceInDays, startOfMonth, subMonths } from "date-fns";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";

interface Project {
  id: string;
  project_number: string;
  title: string;
  status: string;
  priority: string;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  budget_estimated: number | null;
  budget_actual: number | null;
  department_id: string | null;
  project_manager_id: string | null;
  created_at: string | null;
}

interface Task {
  id: string;
  project_id: string;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  due_date: string | null;
  completed_date: string | null;
  is_milestone: boolean | null;
  estimated_hours: number | null;
  actual_hours: number | null;
}

interface AppUser {
  id: string;
  full_name: string;
}

interface Department {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = {
  planned: "#3b82f6",
  in_progress: "#f59e0b",
  on_hold: "#6b7280",
  completed: "#22c55e",
  cancelled: "#ef4444",
};

const TASK_STATUS_COLORS: Record<string, string> = {
  todo: "#3b82f6",
  in_progress: "#f59e0b",
  review: "#a855f7",
  done: "#22c55e",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "#6b7280",
  medium: "#3b82f6",
  high: "#f97316",
  critical: "#ef4444",
};

const statusBadge: Record<string, string> = {
  planned: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  on_hold: "bg-gray-100 text-gray-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

type Health = "On Track" | "At Risk" | "Delayed" | "Completed" | "Cancelled";

const healthBadge: Record<Health, string> = {
  "On Track": "bg-green-100 text-green-800",
  "At Risk": "bg-amber-100 text-amber-800",
  Delayed: "bg-red-100 text-red-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-gray-100 text-gray-700",
};

const chartTooltipStyle = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "8px",
  fontSize: "12px",
};

export default function ProjectAnalysisPage() {
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    let projQuery = supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (!isSuperAdmin && user) {
      projQuery = projQuery.eq("project_manager_id", user.id);
    }
    const [projRes, userRes, deptRes] = await Promise.all([
      projQuery,
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
      supabase.from("production_departments").select("id, name"),
    ]);
    const projList = projRes.data || [];
    setProjects(projList);
    setUsers(userRes.data || []);
    setDepartments(deptRes.data || []);

    if (projList.length > 0) {
      const { data: taskData } = await supabase
        .from("project_tasks")
        .select(
          "id, project_id, title, status, priority, assigned_to, due_date, completed_date, is_milestone, estimated_hours, actual_hours"
        )
        .in("project_id", projList.map((p) => p.id));
      setTasks(taskData || []);
    } else {
      setTasks([]);
    }
    setLoading(false);
  };

  const today = new Date();

  const analysis = useMemo(() => {
    const tasksByProject = new Map<string, Task[]>();
    tasks.forEach((t) => {
      const list = tasksByProject.get(t.project_id) || [];
      list.push(t);
      tasksByProject.set(t.project_id, list);
    });

    const isOverdueProject = (p: Project) =>
      !!p.target_end_date &&
      new Date(p.target_end_date) < today &&
      !["completed", "cancelled"].includes(p.status);

    const isOverdueTask = (t: Task) =>
      !!t.due_date && new Date(t.due_date) < today && t.status !== "done";

    const rows = projects.map((p) => {
      const pTasks = tasksByProject.get(p.id) || [];
      const done = pTasks.filter((t) => t.status === "done").length;
      const progress = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
      const overdueTasks = pTasks.filter(isOverdueTask).length;

      // Expected progress from schedule elapsed time
      let expectedProgress: number | null = null;
      if (p.start_date && p.target_end_date) {
        const total = differenceInDays(new Date(p.target_end_date), new Date(p.start_date));
        const elapsed = differenceInDays(today, new Date(p.start_date));
        if (total > 0) expectedProgress = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
      }

      const daysRemaining = p.target_end_date
        ? differenceInDays(new Date(p.target_end_date), today)
        : null;

      let health: Health;
      if (p.status === "completed") health = "Completed";
      else if (p.status === "cancelled") health = "Cancelled";
      else if (isOverdueProject(p)) health = "Delayed";
      else if (overdueTasks > 0 || (expectedProgress !== null && expectedProgress - progress > 20))
        health = "At Risk";
      else health = "On Track";

      const budgetVariance =
        p.budget_estimated != null && p.budget_actual != null
          ? p.budget_actual - p.budget_estimated
          : null;

      return { project: p, taskCount: pTasks.length, done, progress, expectedProgress, overdueTasks, daysRemaining, health, budgetVariance };
    });

    const activeRows = rows.filter((r) => !["completed", "cancelled"].includes(r.project.status));

    return { rows, activeRows, tasksByProject, isOverdueProject, isOverdueTask };
  }, [projects, tasks]);

  // ---- KPI values ----
  const total = projects.length;
  const active = projects.filter((p) => p.status === "in_progress").length;
  const completed = projects.filter((p) => p.status === "completed").length;
  const overdueProjects = projects.filter((p) => analysis.isOverdueProject(p)).length;
  const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
  const totalTasks = tasks.length;
  const overdueTasks = tasks.filter((t) => analysis.isOverdueTask(t)).length;
  const totalBudgetEst = projects.reduce((s, p) => s + (p.budget_estimated || 0), 0);
  const totalBudgetActual = projects.reduce((s, p) => s + (p.budget_actual || 0), 0);
  const avgProgress =
    analysis.activeRows.length > 0
      ? Math.round(analysis.activeRows.reduce((s, r) => s + r.progress, 0) / analysis.activeRows.length)
      : 0;

  // ---- Chart data ----
  const statusData = Object.keys(STATUS_COLORS)
    .map((status) => ({
      name: status.replace("_", " "),
      key: status,
      value: projects.filter((p) => p.status === status).length,
    }))
    .filter((d) => d.value > 0);

  const priorityData = Object.keys(PRIORITY_COLORS)
    .map((priority) => ({
      name: priority,
      key: priority,
      value: projects.filter((p) => p.priority === priority).length,
    }))
    .filter((d) => d.value > 0);

  const taskStatusData = Object.keys(TASK_STATUS_COLORS)
    .map((status) => ({
      name: status.replace("_", " "),
      key: status,
      value: tasks.filter((t) => t.status === status).length,
    }))
    .filter((d) => d.value > 0);

  const monthlyTrend = useMemo(() => {
    const months: { month: string; created: number; completed: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const monthStart = startOfMonth(subMonths(today, i));
      const monthKey = format(monthStart, "yyyy-MM");
      months.push({
        month: format(monthStart, "MMM yy"),
        created: projects.filter(
          (p) => p.created_at && format(new Date(p.created_at), "yyyy-MM") === monthKey
        ).length,
        completed: projects.filter(
          (p) => p.actual_end_date && format(new Date(p.actual_end_date), "yyyy-MM") === monthKey
        ).length,
      });
    }
    return months;
  }, [projects]);

  const departmentData = useMemo(() => {
    const counts = new Map<string, number>();
    projects.forEach((p) => {
      const name = departments.find((d) => d.id === p.department_id)?.name || "Unassigned";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [projects, departments]);

  const workloadData = useMemo(() => {
    const openTasks = tasks.filter((t) => t.status !== "done");
    const counts = new Map<string, { open: number; overdue: number }>();
    openTasks.forEach((t) => {
      const name = users.find((u) => u.id === t.assigned_to)?.full_name || "Unassigned";
      const entry = counts.get(name) || { open: 0, overdue: 0 };
      entry.open += 1;
      if (analysis.isOverdueTask(t)) entry.overdue += 1;
      counts.set(name, entry);
    });
    return Array.from(counts.entries())
      .map(([name, v]) => ({ name, open: v.open - v.overdue, overdue: v.overdue }))
      .sort((a, b) => b.open + b.overdue - (a.open + a.overdue))
      .slice(0, 10);
  }, [tasks, users, analysis]);

  const budgetData = useMemo(
    () =>
      projects
        .filter((p) => (p.budget_estimated || 0) > 0 || (p.budget_actual || 0) > 0)
        .map((p) => ({
          name: p.project_number,
          title: p.title,
          estimated: p.budget_estimated || 0,
          actual: p.budget_actual || 0,
        }))
        .slice(0, 12),
    [projects]
  );

  const milestones = useMemo(() => {
    const upcoming = tasks
      .filter((t) => t.is_milestone && t.status !== "done")
      .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999"))
      .slice(0, 6);
    return upcoming.map((m) => ({
      ...m,
      projectNumber: projects.find((p) => p.id === m.project_id)?.project_number || "",
      overdue: analysis.isOverdueTask(m),
    }));
  }, [tasks, projects, analysis]);

  // ---- Auto-generated insights ----
  const insights = useMemo(() => {
    const list: { severity: "critical" | "warning" | "info"; text: string }[] = [];
    if (overdueProjects > 0)
      list.push({ severity: "critical", text: `${overdueProjects} project(s) are past their target end date. Review scope or re-plan the schedule.` });
    if (overdueTasks > 0)
      list.push({ severity: "critical", text: `${overdueTasks} task(s) are overdue across the portfolio. Check the workload chart to see who is blocked.` });
    const atRisk = analysis.rows.filter((r) => r.health === "At Risk").length;
    if (atRisk > 0)
      list.push({ severity: "warning", text: `${atRisk} project(s) are at risk — progress is behind the elapsed schedule or tasks have slipped.` });
    const noTasks = analysis.activeRows.filter((r) => r.taskCount === 0).length;
    if (noTasks > 0)
      list.push({ severity: "warning", text: `${noTasks} active project(s) have no tasks yet. Break work down on the Kanban board so progress can be tracked.` });
    const unassigned = tasks.filter((t) => t.status !== "done" && !t.assigned_to).length;
    if (unassigned > 0)
      list.push({ severity: "warning", text: `${unassigned} open task(s) have no assignee. Assign owners so nothing stalls.` });
    const noDates = analysis.activeRows.filter((r) => !r.project.start_date || !r.project.target_end_date).length;
    if (noDates > 0)
      list.push({ severity: "info", text: `${noDates} active project(s) are missing start or target dates, so schedule health cannot be measured for them.` });
    const overBudget = analysis.rows.filter((r) => r.budgetVariance !== null && r.budgetVariance > 0).length;
    if (overBudget > 0)
      list.push({ severity: "warning", text: `${overBudget} project(s) have actual spend above the estimated budget.` });
    const onHold = projects.filter((p) => p.status === "on_hold").length;
    if (onHold > 0)
      list.push({ severity: "info", text: `${onHold} project(s) are on hold. Review whether they should resume or be closed.` });
    if (list.length === 0 && total > 0)
      list.push({ severity: "info", text: "No issues detected — all projects are on track. Keep task statuses updated to keep this accurate." });
    return list;
  }, [analysis, tasks, projects, overdueProjects, overdueTasks, total]);

  const severityStyle: Record<string, string> = {
    critical: "border-red-200 bg-red-50 text-red-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    info: "border-blue-200 bg-blue-50 text-blue-800",
  };

  const fmtMoney = (n: number) =>
    n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : `${n}`;

  if (loading) {
    return (
      <ERPLayout>
        <div className="p-6 text-sm text-muted-foreground">Loading analysis...</div>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <PageHeader
        title="Project Analysis"
        description="Portfolio health, progress, budget and workload analytics"
        icon={BarChart3}
      >
        <Button variant="outline" size="sm" onClick={() => navigate("/projects")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
        </Button>
      </PageHeader>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <MetricCard title="Total Projects" value={total} icon={Briefcase} description={`${active} in progress`} />
        <MetricCard
          title="Completion Rate"
          value={`${completionRate}%`}
          icon={CheckCircle}
          iconColor="text-green-600"
          description={`${completed} completed`}
        />
        <MetricCard
          title="Avg Progress (Active)"
          value={`${avgProgress}%`}
          icon={Clock}
          iconColor="text-yellow-600"
          description={`${analysis.activeRows.length} active projects`}
        />
        <MetricCard
          title="Overdue"
          value={overdueProjects}
          icon={AlertTriangle}
          iconColor="text-red-600"
          description={`${overdueTasks} overdue tasks`}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Tasks" value={totalTasks} icon={ListTodo} description={`${tasks.filter((t) => t.status === "done").length} done`} />
        <MetricCard
          title="Open Tasks"
          value={tasks.filter((t) => t.status !== "done").length}
          icon={Users}
          iconColor="text-blue-600"
          description={`${tasks.filter((t) => t.status !== "done" && !t.assigned_to).length} unassigned`}
        />
        <MetricCard title="Budget Estimated" value={fmtMoney(totalBudgetEst)} icon={Wallet} iconColor="text-cyan-600" />
        <MetricCard
          title="Budget Actual"
          value={fmtMoney(totalBudgetActual)}
          icon={Wallet}
          iconColor={totalBudgetActual > totalBudgetEst ? "text-red-600" : "text-green-600"}
          description={totalBudgetEst > 0 ? `${Math.round((totalBudgetActual / totalBudgetEst) * 100)}% of estimate` : undefined}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="health">Project Health</TabsTrigger>
          <TabsTrigger value="budget">Budget</TabsTrigger>
          <TabsTrigger value="workload">Team Workload</TabsTrigger>
          <TabsTrigger value="insights">Insights ({insights.length})</TabsTrigger>
        </TabsList>

        {/* ---------------- Overview ---------------- */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Projects by Status</CardTitle></CardHeader>
              <CardContent>
                {statusData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {statusData.map((d) => (
                          <Cell key={d.key} fill={STATUS_COLORS[d.key]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Projects by Priority</CardTitle></CardHeader>
              <CardContent>
                {priorityData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={priorityData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar dataKey="value" name="Projects" radius={[4, 4, 0, 0]}>
                        {priorityData.map((d) => (
                          <Cell key={d.key} fill={PRIORITY_COLORS[d.key]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Tasks by Status</CardTitle></CardHeader>
              <CardContent>
                {taskStatusData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={taskStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {taskStatusData.map((d) => (
                          <Cell key={d.key} fill={TASK_STATUS_COLORS[d.key]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Legend wrapperStyle={{ fontSize: "12px" }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly Trend (Created vs Completed)</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="created" name="Created" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="completed" name="Completed" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Projects by Department</CardTitle></CardHeader>
              <CardContent>
                {departmentData.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={departmentData} layout="vertical" margin={{ left: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                      <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={chartTooltipStyle} />
                      <Bar dataKey="value" name="Projects" fill="#06b6d4" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2"><Flag className="h-4 w-4" /> Upcoming Milestones</CardTitle>
            </CardHeader>
            <CardContent>
              {milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open milestones. Mark key tasks as milestones on the Kanban board.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {milestones.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/projects/${m.project_id}`)}
                    >
                      <Flag className={`h-4 w-4 shrink-0 ${m.overdue ? "text-red-500" : "text-amber-500"}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{m.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.projectNumber} • {m.due_date ? format(new Date(m.due_date), "dd MMM yyyy") : "No due date"}
                          {m.overdue && " • Overdue"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Project Health ---------------- */}
        <TabsContent value="health">
          <Card>
            <CardContent className="p-4">
              {analysis.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-2">Project</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Health</th>
                        <th className="p-2 min-w-[140px]">Progress</th>
                        <th className="p-2">Expected</th>
                        <th className="p-2">Tasks</th>
                        <th className="p-2">Overdue Tasks</th>
                        <th className="p-2">Days Left</th>
                        <th className="p-2">Manager</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.rows.map((r) => (
                        <tr
                          key={r.project.id}
                          className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => navigate(`/projects/${r.project.id}`)}
                        >
                          <td className="p-2">
                            <span className="text-xs font-mono text-muted-foreground mr-2">{r.project.project_number}</span>
                            <span className="font-medium">{r.project.title}</span>
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" className={statusBadge[r.project.status] || ""}>
                              {r.project.status.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="p-2">
                            <Badge variant="outline" className={healthBadge[r.health]}>{r.health}</Badge>
                          </td>
                          <td className="p-2">
                            <div className="flex items-center gap-2">
                              <Progress value={r.progress} className="h-2 w-24" />
                              <span className="text-xs">{r.progress}%</span>
                            </div>
                          </td>
                          <td className="p-2 text-xs">{r.expectedProgress !== null ? `${r.expectedProgress}%` : "-"}</td>
                          <td className="p-2 text-xs">{r.done}/{r.taskCount}</td>
                          <td className="p-2 text-xs">
                            {r.overdueTasks > 0 ? (
                              <span className="text-red-600 font-medium">{r.overdueTasks}</span>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td className="p-2 text-xs">
                            {r.daysRemaining === null ? "-" : r.daysRemaining < 0 ? (
                              <span className="text-red-600 font-medium">{Math.abs(r.daysRemaining)}d overdue</span>
                            ) : (
                              `${r.daysRemaining}d`
                            )}
                          </td>
                          <td className="p-2 text-xs">
                            {users.find((u) => u.id === r.project.project_manager_id)?.full_name || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Budget ---------------- */}
        <TabsContent value="budget" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Budget: Estimated vs Actual</CardTitle></CardHeader>
            <CardContent>
              {budgetData.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No budget data. Add estimated and actual budgets to projects to track spend here.
                </p>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={budgetData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={fmtMoney} tick={{ fontSize: 12 }} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value: number) => fmtMoney(value)}
                      labelFormatter={(label) => {
                        const d = budgetData.find((b) => b.name === label);
                        return d ? `${d.name} — ${d.title}` : label;
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="estimated" name="Estimated" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="actual" name="Actual" fill="#f97316" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Budget Variance by Project</CardTitle></CardHeader>
            <CardContent>
              {analysis.rows.filter((r) => r.budgetVariance !== null).length === 0 ? (
                <p className="text-sm text-muted-foreground">No projects with both estimated and actual budgets.</p>
              ) : (
                <div className="space-y-2">
                  {analysis.rows
                    .filter((r) => r.budgetVariance !== null)
                    .sort((a, b) => (b.budgetVariance || 0) - (a.budgetVariance || 0))
                    .map((r) => (
                      <div
                        key={r.project.id}
                        className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-muted/50"
                        onClick={() => navigate(`/projects/${r.project.id}`)}
                      >
                        <div>
                          <p className="text-sm font-medium">
                            <span className="text-xs font-mono text-muted-foreground mr-2">{r.project.project_number}</span>
                            {r.project.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Estimated {fmtMoney(r.project.budget_estimated || 0)} • Actual {fmtMoney(r.project.budget_actual || 0)}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={(r.budgetVariance || 0) > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}
                        >
                          {(r.budgetVariance || 0) > 0 ? "+" : ""}
                          {fmtMoney(r.budgetVariance || 0)}
                        </Badge>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Team Workload ---------------- */}
        <TabsContent value="workload">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Open Tasks by Assignee</CardTitle></CardHeader>
            <CardContent>
              {workloadData.length === 0 ? (
                <p className="text-sm text-muted-foreground">No open tasks.</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(240, workloadData.length * 40)}>
                  <BarChart data={workloadData} layout="vertical" margin={{ left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={chartTooltipStyle} />
                    <Legend wrapperStyle={{ fontSize: "12px" }} />
                    <Bar dataKey="open" name="On schedule" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="overdue" name="Overdue" stackId="a" fill="#ef4444" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ---------------- Insights ---------------- */}
        <TabsContent value="insights">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-amber-500" /> Automated Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              {total === 0 ? (
                <p className="text-sm text-muted-foreground">Create projects to see insights.</p>
              ) : (
                <div className="space-y-2">
                  {insights.map((ins, i) => (
                    <div key={i} className={`flex items-start gap-2 p-3 border rounded-lg text-sm ${severityStyle[ins.severity]}`}>
                      {ins.severity === "critical" ? (
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                      ) : ins.severity === "warning" ? (
                        <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                      ) : (
                        <Lightbulb className="h-4 w-4 mt-0.5 shrink-0" />
                      )}
                      <span>{ins.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </ERPLayout>
  );
}
