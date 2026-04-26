import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Search, Pencil, Code } from "lucide-react";
import { format } from "date-fns";

interface DevTask {
  id: string;
  task_number: string;
  title: string;
  description: string | null;
  module: string | null;
  priority: string;
  status: string;
  estimated_hours: number | null;
  actual_hours: number | null;
  target_date: string | null;
  completed_date: string | null;
  remarks: string | null;
  created_at: string;
}

const MODULES = [
  "Production",
  "QA",
  "HR",
  "Performance",
  "Maintenance",
  "Sales",
  "Purchase",
  "Master Data",
  "Settings",
  "Dashboard",
  "General",
];

export default function DevTasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<DevTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<DevTask | null>(null);

  const [formData, setFormData] = useState({
    title: "",
    description: "",
    module: "",
    priority: "medium",
    status: "draft",
    estimated_hours: "",
    target_date: "",
    remarks: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("development_tasks")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (data) setTasks(data);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.title) {
      toast.error("Please enter a title");
      return;
    }

    try {
      if (editingTask) {
        const { error } = await supabase
          .from("development_tasks")
          .update({
            title: formData.title,
            description: formData.description || null,
            module: formData.module || null,
            priority: formData.priority as "low" | "medium" | "high" | "critical",
            status: formData.status as "draft" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed",
            estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
            target_date: formData.target_date || null,
            completed_date: formData.status === "closed" ? format(new Date(), "yyyy-MM-dd") : null,
            remarks: formData.remarks || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingTask.id);

        if (error) throw error;
        toast.success("Task updated");
      } else {
        const { data: numData } = await supabase.rpc("generate_dev_task_number");

        const { error } = await supabase.from("development_tasks").insert({
          task_number: numData || `DEV-${Date.now()}`,
          title: formData.title,
          description: formData.description || null,
          module: formData.module || null,
          priority: formData.priority as "low" | "medium" | "high" | "critical",
          status: formData.status as "draft" | "in_progress" | "pending_approval" | "approved" | "rejected" | "closed",
          estimated_hours: formData.estimated_hours ? parseFloat(formData.estimated_hours) : null,
          target_date: formData.target_date || null,
          remarks: formData.remarks || null,
          created_by: user?.id,
        });

        if (error) throw error;
        toast.success("Task created");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error saving task:", error);
      toast.error(error.message || "Failed to save task");
    }
  };

  const resetForm = () => {
    setFormData({
      title: "",
      description: "",
      module: "",
      priority: "medium",
      status: "draft",
      estimated_hours: "",
      target_date: "",
      remarks: "",
    });
    setEditingTask(null);
  };

  const openEditDialog = (task: DevTask) => {
    setEditingTask(task);
    setFormData({
      title: task.title,
      description: task.description || "",
      module: task.module || "",
      priority: task.priority,
      status: task.status,
      estimated_hours: task.estimated_hours?.toString() || "",
      target_date: task.target_date || "",
      remarks: task.remarks || "",
    });
    setIsDialogOpen(true);
  };

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      t.task_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.module?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, string> = {
      low: "bg-slate-500",
      medium: "bg-blue-500",
      high: "bg-amber-500",
      critical: "bg-red-500",
    };
    return colors[priority] || "bg-slate-500";
  };

  const columns = [
    { key: "task_number", header: "Task #" },
    { key: "title", header: "Title", className: "max-w-[200px]" },
    { key: "description", header: "Description", className: "max-w-[250px]", render: (row: DevTask) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">{row.description || "-"}</span>
      ),
    },
    { key: "module", header: "Module", render: (row: DevTask) => row.module || "-" },
    { key: "priority", header: "Priority", render: (row: DevTask) => (
        <span className={`px-2 py-1 rounded text-xs text-white ${getPriorityColor(row.priority)}`}>
          {row.priority.toUpperCase()}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (row: DevTask) => <StatusBadge status={row.status} /> },
    { key: "target_date", header: "Target", render: (row: DevTask) => (row.target_date ? format(new Date(row.target_date), "dd-MMM-yyyy") : "-") },
    { key: "remarks", header: "Remarks", className: "max-w-[200px]", render: (row: DevTask) => (
        <span className="line-clamp-2 text-sm text-muted-foreground">{row.remarks || "-"}</span>
      ),
    },
    { key: "id", header: "Actions", render: (row: DevTask) => (
        <Button variant="ghost" size="sm" onClick={() => openEditDialog(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Development Tasks"
        description="Track new feature development and improvements"
        action={{
          label: "New Task",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      <div className="flex items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="pending_approval">Pending Approval</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable columns={columns} data={filteredTasks} />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5 text-primary" />
              {editingTask ? "Edit Development Task" : "New Development Task"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="Enter task title"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Describe the task in detail"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Module</Label>
                <Select value={formData.module} onValueChange={(v) => setFormData({ ...formData, module: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select module" />
                  </SelectTrigger>
                  <SelectContent>
                    {MODULES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Priority</Label>
                <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onValueChange={(v) => setFormData({ ...formData, status: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="pending_approval">Pending Approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Target Date</Label>
                <Input
                  type="date"
                  value={formData.target_date}
                  onChange={(e) => setFormData({ ...formData, target_date: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>Estimated Hours</Label>
              <Input
                type="number"
                step="0.5"
                value={formData.estimated_hours}
                onChange={(e) => setFormData({ ...formData, estimated_hours: e.target.value })}
                placeholder="e.g., 8"
              />
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                placeholder="Any additional notes"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingTask ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
