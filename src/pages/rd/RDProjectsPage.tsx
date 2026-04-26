import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Eye, Edit, Trash2, Printer } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

const STAGES = ["idea", "feasibility", "development", "testing", "validation", "launch"];
const STAGE_LABELS: Record<string, string> = {
  idea: "Idea", feasibility: "Feasibility", development: "Development",
  testing: "Testing", validation: "Validation", launch: "Launch",
};

const INITIAL_GATES = STAGES.map((s, i) => ({
  stage_name: s, stage_order: i + 1,
  status: i === 0 ? "in_progress" : "pending",
  gate_checklist: [], remarks: "",
}));

export default function RDProjectsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const [projects, setProjects] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [filterStage, setFilterStage] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState({
    title: "", description: "", category: "", priority: "medium",
    product_type: "", target_launch_date: "", department_id: "",
    project_lead_id: "", remarks: "",
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const [projRes, deptRes, usersRes] = await Promise.all([
      supabase.from("rd_projects").select("*, project_lead:app_users!rd_projects_project_lead_id_fkey(full_name), department:production_departments!rd_projects_department_id_fkey(name)").order("created_at", { ascending: false }),
      supabase.from("production_departments").select("id, name").eq("is_active", true),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setProjects(projRes.data || []);
    setDepartments(deptRes.data || []);
    setUsers(usersRes.data || []);
    setLoading(false);
  };

  const resetForm = () => setForm({ title: "", description: "", category: "", priority: "medium", product_type: "", target_launch_date: "", department_id: "", project_lead_id: "", remarks: "" });

  const openEdit = (p: any) => {
    setEditingProject(p);
    setForm({
      title: p.title, description: p.description || "", category: p.category || "",
      priority: p.priority || "medium", product_type: p.product_type || "",
      target_launch_date: p.target_launch_date || "", department_id: p.department_id || "",
      project_lead_id: p.project_lead_id || "", remarks: p.remarks || "",
    });
    setDialogOpen(true);
  };

  const openCreate = () => { setEditingProject(null); resetForm(); setDialogOpen(true); };

  const handleSave = async () => {
    if (!form.title) { toast.error("Title is required"); return; }
    const payload = {
      title: form.title, description: form.description || null,
      category: form.category || null, priority: form.priority,
      product_type: form.product_type || null,
      target_launch_date: form.target_launch_date || null,
      department_id: form.department_id || null,
      project_lead_id: form.project_lead_id || null,
      remarks: form.remarks || null,
    };

    if (editingProject) {
      const { error } = await supabase.from("rd_projects").update(payload).eq("id", editingProject.id);
      if (error) { toast.error(error.message); return; }
      toast.success("R&D project updated");
    } else {
      const { data, error } = await supabase.from("rd_projects").insert(payload).select().single();
      if (error) { toast.error(error.message); return; }
      const gates = INITIAL_GATES.map((g) => ({ ...g, project_id: data.id }));
      await supabase.from("rd_stage_gates").insert(gates);
      toast.success("R&D project created");
    }
    setDialogOpen(false);
    resetForm();
    setEditingProject(null);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await supabase.from("rd_stage_gates").delete().eq("project_id", deleteId);
    await supabase.from("rd_experiments").update({ project_id: null }).eq("project_id", deleteId);
    const { error } = await supabase.from("rd_projects").delete().eq("id", deleteId);
    if (error) { toast.error("Failed to delete"); } else { toast.success("R&D project deleted"); loadData(); }
    setDeleteId(null);
  };

  const filtered = projects.filter((p) => {
    if (filterStage !== "all" && p.current_stage !== filterStage) return false;
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    return true;
  });

  const columns = [
    { key: "project_number", header: "Project #" },
    { key: "title", header: "Title" },
    { key: "current_stage", header: "Stage", render: (item: any) => <StatusBadge status={STAGE_LABELS[item.current_stage] || item.current_stage} /> },
    { key: "status", header: "Status", render: (item: any) => <StatusBadge status={item.status} /> },
    { key: "priority", header: "Priority" },
    { key: "project_lead", header: "Lead", render: (item: any) => item.project_lead?.full_name || "-" },
    { key: "department", header: "Department", render: (item: any) => item.department?.name || "-" },
    { key: "actions", header: "Actions", render: (item: any) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); navigate(`/rd/projects/${item.id}`); }}><Eye className="h-4 w-4" /></Button>
        {isSuperAdmin && (
          <>
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openEdit(item); }}><Edit className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDeleteId(item.id); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </>
        )}
      </div>
    )},
  ];

  return (
    <ERPLayout>
      <PageHeader title="R&D Projects" description="Product development projects with stage-gate tracking">
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          )}
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New Project</Button>
        </div>
      </PageHeader>

      <div className="flex gap-2 mb-4">
        <Select value={filterStage} onValueChange={setFilterStage}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            {STAGES.map((s) => <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="on_hold">On Hold</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filtered} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingProject ? "Edit R&D Project" : "New R&D Project"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></div>
              <div><Label>Product Type</Label><Input value={form.product_type} onChange={(e) => setForm({ ...form, product_type: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Target Launch Date</Label><Input type="date" value={form.target_launch_date} onChange={(e) => setForm({ ...form, target_launch_date: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Project Lead</Label>
                <Select value={form.project_lead_id} onValueChange={(v) => setForm({ ...form, project_lead_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div><Label>Remarks</Label><Textarea value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave}>{editingProject ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete R&D Project?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the project and all its stage gates. Linked experiments will be unlinked. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
