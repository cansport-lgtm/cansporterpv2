import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowLeft, Upload, Download, Trash2, Flag, FileText, Printer } from "lucide-react";
import { format, differenceInDays, addDays } from "date-fns";
import { toast } from "sonner";

interface Project {
  id: string;
  project_number: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  start_date: string | null;
  target_end_date: string | null;
  actual_end_date: string | null;
  budget_estimated: number | null;
  budget_actual: number | null;
  methodology: string | null;
  department_id: string | null;
  project_manager_id: string | null;
}

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  start_date: string | null;
  due_date: string | null;
  completed_date: string | null;
  is_milestone: boolean | null;
  milestone_name: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
}

interface Doc {
  id: string;
  file_name: string;
  file_path: string;
  file_size: number | null;
  uploaded_by: string | null;
  remarks: string | null;
  created_at: string | null;
}

interface AppUser {
  id: string;
  full_name: string;
}

const statusColor: Record<string, string> = {
  planned: "bg-blue-100 text-blue-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  on_hold: "bg-gray-100 text-gray-800",
  completed: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
  todo: "bg-blue-100 text-blue-800",
  review: "bg-purple-100 text-purple-800",
  done: "bg-green-100 text-green-800",
};

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadAll();
  }, [id]);

  const loadAll = async () => {
    const [projRes, taskRes, docRes, userRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", id!).single(),
      supabase.from("project_tasks").select("*").eq("project_id", id!).order("sort_order"),
      supabase.from("project_documents").select("*").eq("project_id", id!).order("created_at", { ascending: false }),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    const proj = projRes.data;
    // Non-super_admin users can only view projects assigned to them
    if (proj && !isSuperAdmin && user && proj.project_manager_id !== user.id) {
      toast.error("You don't have access to this project");
      navigate("/projects/dashboard");
      return;
    }
    setProject(proj);
    setTasks(taskRes.data || []);
    setDocs(docRes.data || []);
    setUsers(userRes.data || []);
    setLoading(false);
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;

    const filePath = `${project.id}/${Date.now()}_${file.name}`;
    const { error: uploadError } = await supabase.storage.from("project-documents").upload(filePath, file);
    if (uploadError) { toast.error("Upload failed"); return; }

    const { error } = await supabase.from("project_documents").insert({
      project_id: project.id,
      file_name: file.name,
      file_path: filePath,
      file_size: file.size,
      uploaded_by: user?.id || null,
    });
    if (error) { toast.error("Failed to save document record"); return; }
    toast.success("Document uploaded");
    loadAll();
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDownload = (doc: Doc) => {
    const { data } = supabase.storage.from("project-documents").getPublicUrl(doc.file_path);
    window.open(data.publicUrl, "_blank");
  };

  const handleDeleteDoc = async (docId: string, filePath: string) => {
    await supabase.storage.from("project-documents").remove([filePath]);
    await supabase.from("project_documents").delete().eq("id", docId);
    toast.success("Document deleted");
    loadAll();
  };

  if (loading) return <ERPLayout><div className="p-6">Loading...</div></ERPLayout>;
  if (!project) return <ERPLayout><div className="p-6">Project not found</div></ERPLayout>;

  const milestones = tasks.filter((t) => t.is_milestone);
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Gantt calculations
  const tasksWithDates = tasks.filter((t) => t.start_date && t.due_date);
  const allDates = tasksWithDates.flatMap((t) => [new Date(t.start_date!), new Date(t.due_date!)]);
  const ganttStart = allDates.length > 0 ? new Date(Math.min(...allDates.map((d) => d.getTime()))) : new Date();
  const ganttEnd = allDates.length > 0 ? new Date(Math.max(...allDates.map((d) => d.getTime()))) : addDays(new Date(), 30);
  const totalDays = Math.max(differenceInDays(ganttEnd, ganttStart) + 1, 1);

  return (
    <ERPLayout>
      <PageHeader
        title={`${project.project_number} - ${project.title}`}
        description={project.description || ""}
      >
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          )}
          <Button variant="outline" size="sm" onClick={() => navigate("/projects/list")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
      </PageHeader>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Status</p>
          <Badge className={statusColor[project.status]}>{project.status.replace("_", " ")}</Badge>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Priority</p>
          <Badge variant="secondary">{project.priority}</Badge>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Progress</p>
          <p className="text-lg font-bold">{progress}%</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Tasks</p>
          <p className="text-lg font-bold">{doneTasks}/{totalTasks}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <p className="text-xs text-muted-foreground">Manager</p>
          <p className="text-sm font-medium">{users.find((u) => u.id === project.project_manager_id)?.full_name || "-"}</p>
        </CardContent></Card>
      </div>

      <Tabs defaultValue="tasks">
        <TabsList>
          <TabsTrigger value="tasks">Tasks ({totalTasks})</TabsTrigger>
          <TabsTrigger value="gantt">Gantt Timeline</TabsTrigger>
          <TabsTrigger value="documents">Documents ({docs.length})</TabsTrigger>
          <TabsTrigger value="milestones">Milestones ({milestones.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks">
          <Card>
            <CardContent className="p-4">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tasks yet. Add tasks from the Kanban Board.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="p-2">Title</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Priority</th>
                        <th className="p-2">Assigned To</th>
                        <th className="p-2">Due Date</th>
                        <th className="p-2">Est. Hours</th>
                        {isSuperAdmin && <th className="p-2">Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">
                            {t.is_milestone && "🏆 "}{t.title}
                          </td>
                          <td className="p-2"><Badge variant="outline" className={statusColor[t.status]}>{t.status.replace("_", " ")}</Badge></td>
                          <td className="p-2"><Badge variant="secondary">{t.priority}</Badge></td>
                          <td className="p-2 text-xs">{users.find((u) => u.id === t.assigned_to)?.full_name || "-"}</td>
                          <td className="p-2 text-xs">{t.due_date ? format(new Date(t.due_date), "dd MMM yy") : "-"}</td>
                          <td className="p-2 text-xs">{t.estimated_hours || "-"}</td>
                          {isSuperAdmin && (
                            <td className="p-2">
                              <Button variant="ghost" size="icon" onClick={async () => {
                                await supabase.from("project_tasks").delete().eq("id", t.id);
                                toast.success("Task deleted");
                                loadAll();
                              }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="gantt">
          <Card>
            <CardHeader><CardTitle className="text-sm">Gantt Timeline</CardTitle></CardHeader>
            <CardContent className="p-4">
              {tasksWithDates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add start/due dates to tasks to see the Gantt chart.</p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[800px]">
                    {/* Header with date markers */}
                    <div className="flex border-b pb-1 mb-2">
                      <div className="w-[200px] flex-shrink-0 text-xs font-medium text-muted-foreground">Task</div>
                      <div className="flex-1 relative h-6">
                        {Array.from({ length: Math.min(totalDays, 60) }, (_, i) => {
                          if (i % Math.max(1, Math.floor(totalDays / 10)) === 0) {
                            const d = addDays(ganttStart, i);
                            return (
                              <span
                                key={i}
                                className="absolute text-[10px] text-muted-foreground"
                                style={{ left: `${(i / totalDays) * 100}%` }}
                              >
                                {format(d, "dd MMM")}
                              </span>
                            );
                          }
                          return null;
                        })}
                      </div>
                    </div>
                    {/* Task bars */}
                    {tasksWithDates.map((task) => {
                      const start = differenceInDays(new Date(task.start_date!), ganttStart);
                      const duration = differenceInDays(new Date(task.due_date!), new Date(task.start_date!)) + 1;
                      const leftPct = (start / totalDays) * 100;
                      const widthPct = (duration / totalDays) * 100;
                      const barColor = task.status === "done" ? "bg-green-500" : task.status === "in_progress" ? "bg-yellow-500" : task.status === "review" ? "bg-purple-500" : "bg-blue-500";

                      return (
                        <div key={task.id} className="flex items-center mb-1.5">
                          <div className="w-[200px] flex-shrink-0 text-xs truncate pr-2">
                            {task.is_milestone && "🏆 "}{task.title}
                          </div>
                          <div className="flex-1 relative h-6 bg-muted/30 rounded">
                            <div
                              className={`absolute h-full rounded ${barColor} opacity-80`}
                              style={{ left: `${leftPct}%`, width: `${Math.max(widthPct, 1)}%` }}
                              title={`${task.title}: ${format(new Date(task.start_date!), "dd MMM")} - ${format(new Date(task.due_date!), "dd MMM")}`}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Documents</CardTitle>
                <div>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
                  <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-4 w-4 mr-1" /> Upload
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {docs.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{doc.file_name}</p>
                          <p className="text-xs text-muted-foreground">
                            {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : ""} •{" "}
                            {doc.created_at && format(new Date(doc.created_at), "dd MMM yyyy")}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleDownload(doc)}><Download className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeleteDoc(doc.id, doc.file_path)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="milestones">
          <Card>
            <CardContent className="p-4">
              {milestones.length === 0 ? (
                <p className="text-sm text-muted-foreground">No milestones set. Mark tasks as milestones from the Kanban board.</p>
              ) : (
                <div className="space-y-3">
                  {milestones.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 p-3 border rounded-lg">
                      <Flag className={`h-5 w-5 ${m.status === "done" ? "text-green-500" : "text-amber-500"}`} />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{m.milestone_name || m.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {m.due_date ? `Due: ${format(new Date(m.due_date), "dd MMM yyyy")}` : "No due date"}
                          {m.completed_date && ` • Completed: ${format(new Date(m.completed_date), "dd MMM yyyy")}`}
                        </p>
                      </div>
                      <Badge variant="outline" className={statusColor[m.status]}>{m.status.replace("_", " ")}</Badge>
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
