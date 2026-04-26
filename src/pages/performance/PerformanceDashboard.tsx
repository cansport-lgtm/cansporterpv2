import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, Users, TrendingUp, Award, Calendar, CheckCircle2 } from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

const GOAL_STATUS_COLORS: Record<string, string> = {
  pending: "#94a3b8",
  in_progress: "#3b82f6",
  achieved: "#22c55e",
  not_achieved: "#ef4444",
  partially_achieved: "#f59e0b",
};

const RATING_COLORS: Record<string, string> = {
  Excellent: "#22c55e",
  Good: "#3b82f6",
  Satisfactory: "#f59e0b",
  "Needs Improvement": "#ef4444",
};

export default function PerformanceDashboard() {
  // Fetch active review cycles
  const { data: activeCycles = [] } = useQuery({
    queryKey: ["performance-active-cycles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_review_cycles")
        .select("*")
        .eq("status", "active")
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch KPI stats
  const { data: kpiStats } = useQuery({
    queryKey: ["performance-kpi-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_kpis")
        .select("id, is_active");
      if (error) throw error;
      return {
        total: data.length,
        active: data.filter((k) => k.is_active).length,
      };
    },
  });

  // Fetch goal stats
  const { data: goalStats } = useQuery({
    queryKey: ["performance-goal-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_goals")
        .select("id, status");
      if (error) throw error;

      const statusCounts = data.reduce((acc: Record<string, number>, goal) => {
        acc[goal.status] = (acc[goal.status] || 0) + 1;
        return acc;
      }, {});

      return {
        total: data.length,
        byStatus: Object.entries(statusCounts).map(([status, count]) => ({
          name: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          value: count as number,
          color: GOAL_STATUS_COLORS[status] || "#94a3b8",
        })),
      };
    },
  });

  // Fetch review stats
  const { data: reviewStats } = useQuery({
    queryKey: ["performance-review-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_reviews")
        .select("id, status, overall_rating");
      if (error) throw error;

      const ratingCounts = data.reduce((acc: Record<string, number>, review) => {
        if (review.overall_rating) {
          acc[review.overall_rating] = (acc[review.overall_rating] || 0) + 1;
        }
        return acc;
      }, {});

      return {
        total: data.length,
        completed: data.filter((r) => r.status === "reviewed" || r.status === "acknowledged" || r.status === "closed").length,
        byRating: Object.entries(ratingCounts).map(([rating, count]) => ({
          name: rating,
          value: count as number,
          color: RATING_COLORS[rating] || "#94a3b8",
        })),
      };
    },
  });

  // Fetch employees with goals count
  const { data: employeesWithGoals = 0 } = useQuery({
    queryKey: ["performance-employees-with-goals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("performance_goals")
        .select("employee_id");
      if (error) throw error;
      const uniqueEmployees = new Set(data.map((g) => g.employee_id));
      return uniqueEmployees.size;
    },
  });

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Performance Dashboard"
          description="Overview of employee KPIs, goals, and reviews"
        />

        {/* Active Cycle Banner */}
        {activeCycles.length > 0 && (
          <Card className="border-primary/50 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-primary" />
                <div>
                  <p className="font-medium text-primary">Active Review Cycle</p>
                  <p className="text-sm text-muted-foreground">
                    {activeCycles[0].name} ({new Date(activeCycles[0].start_date).toLocaleDateString()} - {new Date(activeCycles[0].end_date).toLocaleDateString()})
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Metric Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active KPIs"
            value={kpiStats?.active || 0}
            icon={Target}
            description={`${kpiStats?.total || 0} total defined`}
          />
          <MetricCard
            title="Employees Tracked"
            value={employeesWithGoals}
            icon={Users}
            description="With assigned goals"
          />
          <MetricCard
            title="Total Goals"
            value={goalStats?.total || 0}
            icon={TrendingUp}
            description="Across all cycles"
          />
          <MetricCard
            title="Reviews Completed"
            value={reviewStats?.completed || 0}
            icon={Award}
            description={`${reviewStats?.total || 0} total reviews`}
          />
        </div>

        {/* Charts Row */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Goal Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Goal Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {goalStats?.byStatus && goalStats.byStatus.length > 0 ? (
                <>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={goalStats.byStatus}
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={80}
                          dataKey="value"
                          label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {goalStats.byStatus.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {goalStats.byStatus.map((item) => (
                      <div key={item.name} className="flex items-center gap-2 text-sm">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span>{item.name}</span>
                        <span className="font-medium ml-auto">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No goal data available
                </div>
              )}
            </CardContent>
          </Card>

          {/* Review Ratings */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Review Ratings Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              {reviewStats?.byRating && reviewStats.byRating.length > 0 ? (
                <>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={reviewStats.byRating} layout="vertical">
                        <XAxis type="number" />
                        <YAxis dataKey="name" type="category" width={120} />
                        <Tooltip />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                          {reviewStats.byRating.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {reviewStats.byRating.map((item) => (
                      <div key={item.name} className="flex items-center gap-2 text-sm">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span>{item.name}</span>
                        <span className="font-medium ml-auto">{item.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-64 flex items-center justify-center text-muted-foreground">
                  No review data available
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </ERPLayout>
  );
}
