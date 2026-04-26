import { useState, useEffect, useMemo } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import {
  Target,
  TrendingUp,
  Activity,
  DollarSign,
  BarChart3,
  ArrowRight,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";

const PHASE_COLORS: Record<string, string> = {
  define: "bg-blue-100 text-blue-800",
  measure: "bg-purple-100 text-purple-800",
  analyze: "bg-amber-100 text-amber-800",
  improve: "bg-green-100 text-green-800",
  design: "bg-green-100 text-green-800",
  control: "bg-emerald-100 text-emerald-800",
  verify: "bg-emerald-100 text-emerald-800",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800",
  on_hold: "bg-amber-100 text-amber-800",
  completed: "bg-blue-100 text-blue-800",
  cancelled: "bg-red-100 text-red-800",
};

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--chart-2))", "hsl(var(--chart-3))", "hsl(var(--chart-4))", "hsl(var(--chart-5))"];

export default function SixSigmaDashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [projRes, metRes] = await Promise.all([
      supabase.from("six_sigma_projects").select("*").order("created_at", { ascending: false }),
      supabase.from("six_sigma_metrics").select("*").order("measurement_date", { ascending: false }),
    ]);
    setProjects(projRes.data || []);
    setMetrics(metRes.data || []);
    setLoading(false);
  };

  const stats = useMemo(() => {
    const active = projects.filter((p) => p.status === "active").length;
    const completed = projects.filter((p) => p.status === "completed").length;
    const totalSavings = projects.reduce((s, p) => s + (p.actual_savings || 0), 0);
    const avgSigma = projects.length > 0
      ? projects.reduce((s, p) => s + (p.current_sigma || 0), 0) / projects.filter(p => p.current_sigma).length || 0
      : 0;
    return { active, completed, totalSavings, avgSigma, total: projects.length };
  }, [projects]);

  const phaseDistribution = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.filter(p => p.status === 'active').forEach((p) => {
      counts[p.current_phase] = (counts[p.current_phase] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name: name.charAt(0).toUpperCase() + name.slice(1), value }));
  }, [projects]);

  const methodologyBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    projects.forEach((p) => {
      counts[p.methodology] = (counts[p.methodology] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [projects]);

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Six Sigma Dashboard" description="Monitor improvement projects and quality metrics" />

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard title="Active Projects" value={stats.active} icon={Activity} iconColor="text-primary" />
          <MetricCard title="Completed" value={stats.completed} icon={CheckCircle2} iconColor="text-green-600" />
          <MetricCard
            title="Total Savings"
            value={`₹${(stats.totalSavings / 1000).toFixed(0)}K`}
            icon={DollarSign}
            iconColor="text-emerald-600"
          />
          <MetricCard
            title="Avg Sigma Level"
            value={stats.avgSigma ? stats.avgSigma.toFixed(2) + "σ" : "N/A"}
            icon={Target}
            iconColor="text-blue-600"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Phase Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Active Projects by Phase</CardTitle>
            </CardHeader>
            <CardContent>
              {phaseDistribution.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={phaseDistribution}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" className="text-xs" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-center py-8">No active projects yet</p>
              )}
            </CardContent>
          </Card>

          {/* Methodology Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Methodology Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              {methodologyBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={methodologyBreakdown} cx="50%" cy="50%" outerRadius={80} dataKey="value" label>
                      {methodologyBreakdown.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-muted-foreground text-center py-8">No projects yet</p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Projects */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Projects</CardTitle>
            <Button size="sm" variant="outline" onClick={() => navigate("/six-sigma/projects")}>
              View All <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent>
            {projects.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">No projects created yet</p>
            ) : (
              <div className="space-y-3">
                {projects.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={() => navigate("/six-sigma/projects")}
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{p.project_number}</span>
                        <span className="text-sm text-muted-foreground">—</span>
                        <span className="text-sm">{p.title}</span>
                      </div>
                      <div className="flex gap-2">
                        <Badge variant="outline" className={PHASE_COLORS[p.current_phase] || ""}>
                          {p.current_phase}
                        </Badge>
                        <Badge variant="outline" className={STATUS_COLORS[p.status] || ""}>
                          {p.status}
                        </Badge>
                        <Badge variant="secondary">{p.methodology}</Badge>
                      </div>
                    </div>
                    {p.current_sigma && (
                      <span className="text-lg font-bold text-primary">{p.current_sigma}σ</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
