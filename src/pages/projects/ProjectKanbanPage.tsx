import { useEffect, useState, DragEvent } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TaskFormDialog, MoveTaskDialog, ProjectTask } from "@/components/projects/TaskDialogs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, GripVertical, Calendar, User } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

interface Project {
  id: string;
  project_number: string;
  title: string;
}

interface Task extends ProjectTask {
  project_id: string;
  task_number: string | null;
  sort_order: number | null;
}

interface AppUser {
  id: string;
  full_name: string;
}

const COLUMNS = [
  { key: "todo", label: "To Do", color: "border-t-blue-500" },
  { key: "in_progress", label: "In Progress", color: "border-t-yellow-500" },
  { key: "review", label: "Review", color: "border-t-purple-500" },
  { key: "done", label: "Done", color: "border-t-green-500" },
];

const priorityColor: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

export default function ProjectKanbanPage() {
  const { user, hasRole } = useAuth();
  // super_admin and Projects Super Manager see every project; everyone else only their own
  const canViewAllProjects = hasRole('projects_super_manager');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [_loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [newStatus, setNewStatus] = useState("todo");
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{ task: Task; toStatus: string } | null>(null);

  useEffect(() => {
    loadInitial();
  }, []);

  useEffect(() => {
    if (selectedProjectId) loadTasks();
  }, [selectedProjectId]);

  const loadInitial = async () => {
    let projQuery = supabase.from("projects").select("id, project_number, title").order("created_at", { ascending: false });
    if (!canViewAllProjects && user) {
      projQuery = projQuery.eq("project_manager_id", user.id);
    }
    const [projRes, userRes] = await Promise.all([
      projQuery,
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    const projs = projRes.data || [];
    setProjects(projs);
    setUsers(userRes.data || []);
    if (projs.length > 0) setSelectedProjectId(projs[0].id);
    setLoading(false);
  };

  const loadTasks = async () => {
    const { data } = await supabase
      .from("project_tasks")
      .select("*")
      .eq("project_id", selectedProjectId)
      .order("sort_order", { ascending: true });
    setTasks(data || []);
  };

  const openCreate = (status: string) => {
    setEditingTask(null);
    setNewStatus(status);
    setDialogOpen(true);
  };

  const openEdit = (task: ProjectTask) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleSave = async (payload: Record<string, unknown>): Promise<boolean> => {
    if (editingTask) {
      const { error } = await supabase.from("project_tasks").update(payload).eq("id", editingTask.id);
      if (error) { toast.error("Failed to update task"); return false; }
      toast.success("Task updated");
    } else {
      const sortOrder = tasks.filter((t) => t.status === payload.status).length;
      const { error } = await supabase
        .from("project_tasks")
        .insert({ ...payload, project_id: selectedProjectId, sort_order: sortOrder } as never);
      if (error) { toast.error("Failed to create task"); return false; }
      toast.success("Task created");
    }
    loadTasks();
    return true;
  };

  const handleDragStart = (e: DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const updateTaskStatus = async (task: ProjectTask, payload: Record<string, unknown>): Promise<boolean> => {
    const { error } = await supabase.from("project_tasks").update(payload).eq("id", task.id);
    if (error) { toast.error("Failed to move task"); return false; }
    loadTasks();
    return true;
  };

  const handleDrop = async (e: DragEvent, newStatus: string) => {
    e.preventDefault();
    const task = tasks.find((t) => t.id === draggedTaskId);
    setDraggedTaskId(null);
    if (!task || task.status === newStatus) return;

    // Moving into or out of Done needs confirmation (completion date / reopen)
    if (newStatus === "done" || task.status === "done") {
      setPendingMove({ task, toStatus: newStatus });
      return;
    }
    await updateTaskStatus(task, { status: newStatus });
  };

  const getColumnTasks = (status: string) => tasks.filter((t) => t.status === status);

  return (
    <ERPLayout>
      <PageHeader title="Kanban Board" description="Drag & drop tasks across columns">
        <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
          <SelectTrigger className="w-[280px]"><SelectValue placeholder="Select project" /></SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.project_number} - {p.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      {!selectedProjectId ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">Select a project to view its tasks</CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className={`rounded-lg border-t-4 ${col.color} bg-muted/30 min-h-[400px] flex flex-col`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, col.key)}
            >
              <div className="p-3 flex items-center justify-between">
                <h3 className="font-semibold text-sm">{col.label}</h3>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">{getColumnTasks(col.key).length}</Badge>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openCreate(col.key)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 p-2 space-y-2 overflow-y-auto">
                {getColumnTasks(col.key).map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onClick={() => openEdit(task)}
                    className={`p-3 rounded-md bg-background border shadow-sm cursor-grab hover:shadow-md transition-shadow ${
                      draggedTaskId === task.id ? "opacity-50" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{task.title}</p>
                        {task.is_milestone && (
                          <Badge variant="outline" className="text-xs mt-1 bg-amber-50 text-amber-700">
                            🏆 Milestone
                          </Badge>
                        )}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          <Badge className={`text-[10px] ${priorityColor[task.priority]}`}>{task.priority}</Badge>
                          {task.due_date && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Calendar className="h-3 w-3" />
                              {format(new Date(task.due_date), "dd MMM")}
                            </span>
                          )}
                          {task.status === "done" && task.completed_date && (
                            <span className="text-[10px] text-green-700 flex items-center gap-0.5">
                              ✓ {format(new Date(task.completed_date), "dd MMM")}
                            </span>
                          )}
                          {task.status === "done" && (task.actual_hours ?? 0) > 0 && (
                            <span className="text-[10px] text-muted-foreground">
                              {task.actual_hours}h{task.estimated_hours ? ` / ${task.estimated_hours}h` : ""}
                            </span>
                          )}
                          {task.assigned_to && (
                            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <User className="h-3 w-3" />
                              {users.find((u) => u.id === task.assigned_to)?.full_name?.split(" ")[0] || ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <TaskFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        initialStatus={newStatus}
        users={users}
        onSubmit={handleSave}
      />

      <MoveTaskDialog
        move={pendingMove}
        onCancel={() => setPendingMove(null)}
        onConfirm={async (task, payload) => {
          const ok = await updateTaskStatus(task, payload);
          if (ok) setPendingMove(null);
          return ok;
        }}
      />
    </ERPLayout>
  );
}
