import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { FlaskConical, Lightbulb, Rocket, TestTube, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const STAGES = ["idea", "feasibility", "development", "testing", "validation", "launch"];
const STAGE_LABELS: Record<string, string> = {
  idea: "Idea", feasibility: "Feasibility", development: "Development",
  testing: "Testing", validation: "Validation", launch: "Launch",
};
const STAGE_COLORS: Record<string, string> = {
  idea: "bg-blue-500", feasibility: "bg-yellow-500", development: "bg-orange-500",
  testing: "bg-purple-500", validation: "bg-cyan-500", launch: "bg-green-500",
};

export default function RDDashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<any[]>([]);
  const [experiments, setExperiments] = useState<any[]>([]);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const [projRes, expRes] = await Promise.all([
      supabase.from("rd_projects").select("*").order("created_at", { ascending: false }),
      supabase.from("rd_experiments").select("*").order("created_at", { ascending: false }).limit(5),
    ]);
    setProjects(projRes.data || []);
    setExperiments(expRes.data || []);
  };

  const activeProjects = projects.filter((p) => p.status === "active");
  const stageCounts = STAGES.map((s) => ({
    stage: s,
    count: activeProjects.filter((p) => p.current_stage === s).length,
  }));
  const maxCount = Math.max(...stageCounts.map((s) => s.count), 1);

  return (
    <ERPLayout>
      <PageHeader title="Product Dev & R&D" description="New product development and experiment tracking" />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Projects" value={projects.length} icon={FlaskConical} />
        <MetricCard title="Active Projects" value={activeProjects.length} icon={Lightbulb} />
        <MetricCard title="In Testing" value={projects.filter((p) => p.current_stage === "testing").length} icon={TestTube} />
        <MetricCard title="Launched" value={projects.filter((p) => p.current_stage === "launch").length} icon={Rocket} />
      </div>

      <Card className="mb-6">
        <CardHeader><CardTitle className="text-base">Stage-Gate Pipeline</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 h-32">
            {stageCounts.map((s, i) => (
              <div key={s.stage} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-lg font-bold">{s.count}</span>
                <div className={`w-full rounded-t ${STAGE_COLORS[s.stage]} transition-all`} style={{ height: `${(s.count / maxCount) * 80}px`, minHeight: s.count > 0 ? "16px" : "4px" }} />
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}
                  <span className="font-medium">{STAGE_LABELS[s.stage]}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Recent Projects</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/rd/projects")}>View All</Button>
          </CardHeader>
          <CardContent>
            {projects.slice(0, 5).map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div><p className="font-medium text-sm">{p.title}</p><p className="text-xs text-muted-foreground">{p.project_number}</p></div>
                <Badge variant="outline">{STAGE_LABELS[p.current_stage] || p.current_stage}</Badge>
              </div>
            ))}
            {projects.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No projects yet</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">Recent Experiments</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate("/rd/experiments")}>View All</Button>
          </CardHeader>
          <CardContent>
            {experiments.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div><p className="font-medium text-sm">{e.title}</p><p className="text-xs text-muted-foreground">{e.experiment_number}</p></div>
                <Badge variant={e.status === "completed" ? "default" : "outline"}>{e.status}</Badge>
              </div>
            ))}
            {experiments.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">No experiments yet</p>}
          </CardContent>
        </Card>
      </div>
    </ERPLayout>
  );
}
