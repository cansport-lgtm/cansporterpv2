import { useState, useEffect } from "react";
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

export default function RDExperimentsPage() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  const [experiments, setExperiments] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingExp, setEditingExp] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewExp, setViewExp] = useState<any>(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [form, setForm] = useState({
    title: "", objective: "", methodology: "", materials_used: "",
    results: "", observations: "", conclusion: "", status: "planned",
    project_id: "", conducted_by: "", experiment_date: new Date().toISOString().split("T")[0],
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const [expRes, projRes, usersRes] = await Promise.all([
      supabase.from("rd_experiments").select("*, project:rd_projects(title, project_number), conductor:app_users!rd_experiments_conducted_by_fkey(full_name)").order("created_at", { ascending: false }),
      supabase.from("rd_projects").select("id, title, project_number").eq("status", "active"),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setExperiments(expRes.data || []);
    setProjects(projRes.data || []);
    setUsers(usersRes.data || []);
    setLoading(false);
  };

  const resetForm = () => setForm({ title: "", objective: "", methodology: "", materials_used: "", results: "", observations: "", conclusion: "", status: "planned", project_id: "", conducted_by: "", experiment_date: new Date().toISOString().split("T")[0] });

  const openCreate = () => { setEditingExp(null); resetForm(); setDialogOpen(true); };

  const openEdit = (exp: any) => {
    setEditingExp(exp);
    setForm({
      title: exp.title || "", objective: exp.objective || "", methodology: exp.methodology || "",
      materials_used: exp.materials_used || "", results: exp.results || "", observations: exp.observations || "",
      conclusion: exp.conclusion || "", status: exp.status || "planned",
      project_id: exp.project_id || "", conducted_by: exp.conducted_by || "",
      experiment_date: exp.experiment_date || new Date().toISOString().split("T")[0],
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title) { toast.error("Title is required"); return; }
    const payload = {
      title: form.title, objective: form.objective || null,
      methodology: form.methodology || null, materials_used: form.materials_used || null,
      results: form.results || null, observations: form.observations || null,
      conclusion: form.conclusion || null, status: form.status,
      project_id: form.project_id || null, conducted_by: form.conducted_by || null,
      experiment_date: form.experiment_date,
    };
    if (editingExp) {
      const { error } = await supabase.from("rd_experiments").update(payload).eq("id", editingExp.id);
      if (error) { toast.error(error.message); return; }
      toast.success("Experiment updated");
    } else {
      const { error } = await supabase.from("rd_experiments").insert(payload);
      if (error) { toast.error(error.message); return; }
      toast.success("Experiment created");
    }
    setDialogOpen(false);
    resetForm();
    setEditingExp(null);
    loadData();
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    const { error } = await supabase.from("rd_experiments").delete().eq("id", deleteId);
    if (error) { toast.error("Failed to delete"); } else { toast.success("Experiment deleted"); loadData(); }
    setDeleteId(null);
  };

  const filtered = filterStatus === "all" ? experiments : experiments.filter((e) => e.status === filterStatus);

  const columns = [
    { key: "experiment_number", header: "Experiment #" },
    { key: "title", header: "Title" },
    { key: "project", header: "Project", render: (item: any) => item.project?.title || "-" },
    { key: "status", header: "Status", render: (item: any) => <StatusBadge status={item.status} /> },
    { key: "conductor", header: "Conducted By", render: (item: any) => item.conductor?.full_name || "-" },
    { key: "experiment_date", header: "Date" },
    { key: "actions", header: "Actions", render: (item: any) => (
      <div className="flex gap-1">
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setViewExp(item); }}><Eye className="h-4 w-4" /></Button>
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
      <PageHeader title="R&D Experiments" description="Track experiments, trials, and observations">
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          )}
          <Button onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New Experiment</Button>
        </div>
      </PageHeader>

      <div className="flex gap-2 mb-4">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="planned">Planned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filtered} />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editingExp ? "Edit Experiment" : "New Experiment"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Title *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label>Objective</Label><Textarea value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Linked Project</Label>
                <Select value={form.project_id} onValueChange={(v) => setForm({ ...form, project_id: v })}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Conducted By</Label>
                <Select value={form.conducted_by} onValueChange={(v) => setForm({ ...form, conducted_by: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="planned">Planned</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Date</Label><Input type="date" value={form.experiment_date} onChange={(e) => setForm({ ...form, experiment_date: e.target.value })} /></div>
            </div>
            <div><Label>Methodology</Label><Textarea value={form.methodology} onChange={(e) => setForm({ ...form, methodology: e.target.value })} /></div>
            <div><Label>Materials Used</Label><Textarea value={form.materials_used} onChange={(e) => setForm({ ...form, materials_used: e.target.value })} /></div>
            <div><Label>Results</Label><Textarea value={form.results} onChange={(e) => setForm({ ...form, results: e.target.value })} /></div>
            <div><Label>Observations</Label><Textarea value={form.observations} onChange={(e) => setForm({ ...form, observations: e.target.value })} /></div>
            <div><Label>Conclusion</Label><Textarea value={form.conclusion} onChange={(e) => setForm({ ...form, conclusion: e.target.value })} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave}>{editingExp ? "Update" : "Create"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewExp} onOpenChange={() => setViewExp(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{viewExp?.title}</DialogTitle></DialogHeader>
          {viewExp && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Number:</span> {viewExp.experiment_number}</div>
                <div><span className="text-muted-foreground">Status:</span> <StatusBadge status={viewExp.status} /></div>
                <div><span className="text-muted-foreground">Date:</span> {viewExp.experiment_date}</div>
                <div><span className="text-muted-foreground">Project:</span> {viewExp.project?.title || "-"}</div>
                <div><span className="text-muted-foreground">Conducted By:</span> {viewExp.conductor?.full_name || "-"}</div>
              </div>
              {viewExp.objective && <div><p className="text-muted-foreground font-medium">Objective</p><p>{viewExp.objective}</p></div>}
              {viewExp.methodology && <div><p className="text-muted-foreground font-medium">Methodology</p><p>{viewExp.methodology}</p></div>}
              {viewExp.materials_used && <div><p className="text-muted-foreground font-medium">Materials Used</p><p>{viewExp.materials_used}</p></div>}
              {viewExp.results && <div><p className="text-muted-foreground font-medium">Results</p><p>{viewExp.results}</p></div>}
              {viewExp.observations && <div><p className="text-muted-foreground font-medium">Observations</p><p>{viewExp.observations}</p></div>}
              {viewExp.conclusion && <div><p className="text-muted-foreground font-medium">Conclusion</p><p>{viewExp.conclusion}</p></div>}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Experiment?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete this experiment. This cannot be undone.</AlertDialogDescription>
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
