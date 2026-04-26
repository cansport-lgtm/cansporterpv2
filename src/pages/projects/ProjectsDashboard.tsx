import { useEffect, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricCard } from "@/components/shared/MetricCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { FolderKanban, Plus, Clock, CheckCircle, AlertTriangle, Briefcase } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";

interface Project {
  id: string;
  project_number: string;
  title: string;
  status: string;
  priority: string;
  start_date: string | null;
  target_end_date: string | null;
  project_manager_id: string | null;
  created_at: string | null;
}

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    let query = supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (!isSuperAdmin && user) {
      query = query.eq("project_manager_id", user.id);
    }
    const { data } = await query;
    setProjects(data || []);
    setLoading(false);
  };

  const total = projects.length;
  const active = projects.filter((p) => p.status === "in_progress").length;
  const completed = projects.filter((p) => p.status === "completed").length;
  const overdue = projects.filter(
    (p) =>
      p.target_end_date &&
      new Date(p.target_end_date) < new Date() &&
      !["completed", "cancelled"].includes(p.status)
  ).length;

  const statusColor: Record<string, string> = {
    planned: "bg-blue-100 text-blue-800",
    in_progress: "bg-yellow-100 text-yellow-800",
    on_hold: "bg-gray-100 text-gray-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };

  const recentProjects = projects.slice(0, 8);

  return (
    <ERPLayout>
      <PageHeader
        title="Project Management"
        description="Overview of manufacturing projects"
      >
        <Button onClick={() => navigate("/projects/list")} size="sm">
          <Plus className="h-4 w-4 mr-1" /> New Project
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard title="Total Projects" value={total} icon={Briefcase} />
        <MetricCard title="Active" value={active} icon={Clock} iconColor="text-yellow-600" />
        <MetricCard title="Completed" value={completed} icon={CheckCircle} iconColor="text-green-600" />
        <MetricCard title="Overdue" value={overdue} icon={AlertTriangle} iconColor="text-red-600" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" /> Recent Projects
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : recentProjects.length === 0 ? (
            <p className="text-muted-foreground text-sm">No projects yet. Create your first project!</p>
          ) : (
            <div className="space-y-3">
              {recentProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-muted-foreground">
                        {project.project_number}
                      </span>
                      <span className="font-medium text-sm">{project.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {project.start_date && format(new Date(project.start_date), "dd MMM yyyy")}
                      {project.target_end_date &&
                        ` → ${format(new Date(project.target_end_date), "dd MMM yyyy")}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={statusColor[project.status] || ""}>
                      {project.status.replace("_", " ")}
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {project.priority}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </ERPLayout>
  );
}
