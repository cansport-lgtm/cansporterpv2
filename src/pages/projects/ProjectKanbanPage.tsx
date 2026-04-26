import { useEffect, useState, DragEvent } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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

interface Task {
  id: string;
  project_id: string;
  task_number: string | null;
  title: string;
  description: string | null;
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

const PRIORITIES = ["low", "medium", "high", "critical"];

const priorityColor: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  critical: "bg-red-100 text-red-700",
};

export default function ProjectKanbanPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [_loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);

  const [form, setForm] = useState({
    title: "", description: "", priority: "medium", assigned_to: "",
    start_date: "", due_date: "", is_milestone: false, milestone_name: "",
    estimated_hours: "",
  });

  useEffect(() => {
    loadInitial();
  }, []);

  useEffect(() => {
    if (selectedProjectId) loadTasks();
  }, [selectedProjectId]);

  const loadInitial = async () => {
    let projQuery = supabase.from("projects").select("id, project_number, title").order("created_at", { ascending: false });
    if (!isSuperAdmin && user) {
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
    setForm({
      title: "", description: "", priority: "medium", assigned_to: "",
      start_date: "", due_date: "", is_milestone: false, milestone_name: "", estimated_hours: "",
    });
    setDialogOpen(true);
    // Store initial status in a temp way
    (window as any).__kanbanNewStatus = status;
  };

  const openEdit = (task: Task) => {
    setEditingTask(task);
    setForm({
      title: task.title,
      description: task.description || "",
      priority: task.priority,
      assigned_to: task.assigned_to || "",
      start_date: task.start_date || "",
      due_date: task.due_date || "",
      is_milestone: task.is_milestone || false,
      milestone_name: task.milestone_name || "",
      estimated_hours: task.estimated_hours?.toString() || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }

    const payload: any = {
      title: form.title,
      description: form.description || null,
      priority: form.priority,
      assigned_to: form.assigned_to || null,
      start_date: form.start_date || null,
      due_date: form.due_date || null,
      is_milestone: form.is_milestone,
      milestone_name: form.is_milestone ? form.milestone_name : null,
      estimated_hours: form.estimated_hours ? parseFloat(form.estimated_hours) : 0,
    };

    if (editingTask) {
      const { error } = await supabase.from("project_tasks").update(payload).eq("id", editingTask.id);
      if (error) { toast.error("Failed to update task"); return; }
      toast.success("Task updated");
    } else {
      payload.project_id = selectedProjectId;
      payload.status = (window as any).__kanbanNewStatus || "todo";
      payload.sort_order = tasks.filter((t) => t.status === payload.status).length;
      const { error } = await supabase.from("project_tasks").insert(payload);
      if (error) { toast.error("Failed to create task"); return; }
      toast.success("Task created");
    }

    setDialogOpen(false);
    loadTasks();
  };

  const handleDragStart = (e: DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: DragEvent, newStatus: string) => {
    e.preventDefault();
    if (!draggedTaskId) return;

    const payload: any = { status: newStatus };
    if (newStatus === "done") payload.completed_date = new Date().toISOString().split("T")[0];
    else payload.completed_date = null;

    await supabase.from("project_tasks").update(payload).eq("id", draggedTaskId);
    setDraggedTaskId(null);
    loadTasks();
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? "Edit Task" : "New Task"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assigned To</Label>
              <Select value={form.assigned_to} onValueChange={(v) => setForm({ ...form, assigned_to: v })}>
                <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
                <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Start Date</Label><Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
              <div><Label>Due Date</Label><Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
            </div>
            <div><Label>Estimated Hours</Label><Input type="number" value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })} /></div>
            <div className="flex items-center gap-2">
              <Checkbox checked={form.is_milestone} onCheckedChange={(v) => setForm({ ...form, is_milestone: !!v })} />
              <Label>Mark as Milestone</Label>
            </div>
            {form.is_milestone && (
              <div><Label>Milestone Name</Label><Input value={form.milestone_name} onChange={(e) => setForm({ ...form, milestone_name: e.target.value })} /></div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingTask ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
