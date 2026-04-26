import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Plus, Search, Eye, Trash2 } from "lucide-react";
import { format } from "date-fns";

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

const DMAIC_PHASES = ["define", "measure", "analyze", "improve", "control"];
const DMADV_PHASES = ["define", "measure", "analyze", "design", "verify"];

export default function SixSigmaProjectsPage() {
  const { user, roles } = useAuth();
  const isSuperAdmin = roles.some((r) => r.role === "super_admin");
  const [projects, setProjects] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterMethodology, setFilterMethodology] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const [form, setForm] = useState({
    title: "",
    description: "",
    methodology: "DMAIC",
    priority: "medium",
    department_id: "",
    champion_id: "",
    belt_leader_id: "",
    start_date: format(new Date(), "yyyy-MM-dd"),
    target_completion: "",
    problem_statement: "",
    goal_statement: "",
    scope: "",
    baseline_sigma: "",
    target_sigma: "",
    baseline_dpmo: "",
    target_dpmo: "",
    estimated_savings: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    const [projRes, deptRes, usersRes] = await Promise.all([
      supabase.from("six_sigma_projects").select("*").order("created_at", { ascending: false }),
      supabase.from("production_departments").select("id, name").eq("is_active", true),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setProjects(projRes.data || []);
    setDepartments(deptRes.data || []);
    setUsers(usersRes.data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!form.title) {
      toast.error("Project title is required");
      return;
    }
    const insertData: any = {
      title: form.title,
      description: form.description || null,
      methodology: form.methodology,
      priority: form.priority,
      department_id: form.department_id || null,
      champion_id: form.champion_id || null,
      belt_leader_id: form.belt_leader_id || null,
      start_date: form.start_date || null,
      target_completion: form.target_completion || null,
      problem_statement: form.problem_statement || null,
      goal_statement: form.goal_statement || null,
      scope: form.scope || null,
      baseline_sigma: form.baseline_sigma ? parseFloat(form.baseline_sigma) : null,
      target_sigma: form.target_sigma ? parseFloat(form.target_sigma) : null,
      baseline_dpmo: form.baseline_dpmo ? parseFloat(form.baseline_dpmo) : null,
      target_dpmo: form.target_dpmo ? parseFloat(form.target_dpmo) : null,
      estimated_savings: form.estimated_savings ? parseFloat(form.estimated_savings) : null,
      current_phase: "define",
      project_number: "",
    };

    const { data, error } = await supabase.from("six_sigma_projects").insert(insertData).select().single();
    if (error) {
      toast.error("Failed to create project: " + error.message);
      return;
    }

    // Auto-create phase records
    const phases = form.methodology === "DMADV" ? DMADV_PHASES : DMAIC_PHASES;
    const phaseRecords = phases.map((p, i) => ({
      project_id: data.id,
      phase_name: p,
      status: i === 0 ? "in_progress" : "pending",
    }));
    await supabase.from("six_sigma_phases").insert(phaseRecords);

    toast.success("Six Sigma project created!");
    setIsCreateOpen(false);
    setForm({
      title: "", description: "", methodology: "DMAIC", priority: "medium",
      department_id: "", champion_id: "", belt_leader_id: "",
      start_date: format(new Date(), "yyyy-MM-dd"), target_completion: "",
      problem_statement: "", goal_statement: "", scope: "",
      baseline_sigma: "", target_sigma: "", baseline_dpmo: "", target_dpmo: "",
      estimated_savings: "",
    });
    fetchData();
  };

  const handleUpdatePhase = async (projectId: string, newPhase: string) => {
    await supabase.from("six_sigma_projects").update({ current_phase: newPhase }).eq("id", projectId);
    // Update phase statuses
    const project = projects.find((p) => p.id === projectId);
    const phases = project?.methodology === "DMADV" ? DMADV_PHASES : DMAIC_PHASES;
    const phaseIdx = phases.indexOf(newPhase);
    for (let i = 0; i < phases.length; i++) {
      const status = i < phaseIdx ? "completed" : i === phaseIdx ? "in_progress" : "pending";
      await supabase.from("six_sigma_phases").update({ status }).eq("project_id", projectId).eq("phase_name", phases[i]);
    }
    toast.success(`Phase updated to ${newPhase}`);
    fetchData();
  };

  const handleUpdateStatus = async (projectId: string, newStatus: string) => {
    const update: any = { status: newStatus };
    if (newStatus === "completed") update.actual_completion = format(new Date(), "yyyy-MM-dd");
    await supabase.from("six_sigma_projects").update(update).eq("id", projectId);
    toast.success(`Status updated to ${newStatus}`);
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this project?")) return;
    await supabase.from("six_sigma_projects").delete().eq("id", id);
    toast.success("Project deleted");
    fetchData();
  };

  const filteredProjects = projects.filter((p) => {
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (filterMethodology !== "all" && p.methodology !== filterMethodology) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        p.title?.toLowerCase().includes(q) ||
        p.project_number?.toLowerCase().includes(q) ||
        p.problem_statement?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const getUserName = (id: string) => users.find((u) => u.id === id)?.full_name || "-";
  const getDeptName = (id: string) => departments.find((d) => d.id === id)?.name || "-";

  return (
    <ERPLayout>
      <div className="space-y-4">
        <PageHeader title="Six Sigma Projects" description="DMAIC & DMADV improvement projects">
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        </PageHeader>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="on_hold">On Hold</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterMethodology} onValueChange={setFilterMethodology}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Methods</SelectItem>
              <SelectItem value="DMAIC">DMAIC</SelectItem>
              <SelectItem value="DMADV">DMADV</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Projects Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project #</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Phase</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sigma</TableHead>
                  <TableHead>Savings</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProjects.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No projects found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredProjects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-mono text-xs">{p.project_number}</TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate">{p.title}</TableCell>
                      <TableCell><Badge variant="secondary">{p.methodology}</Badge></TableCell>
                      <TableCell>
                        <Badge variant="outline" className={PHASE_COLORS[p.current_phase] || ""}>
                          {p.current_phase}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[p.status] || ""}>
                          {p.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {p.current_sigma ? `${p.current_sigma}σ` : p.baseline_sigma ? `${p.baseline_sigma}σ` : "-"}
                      </TableCell>
                      <TableCell>
                        {p.actual_savings ? `₹${(p.actual_savings / 1000).toFixed(0)}K` : "-"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelectedProject(p);
                              setIsDetailOpen(true);
                            }}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {isSuperAdmin && (
                            <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Six Sigma Project</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Methodology</Label>
              <Select value={form.methodology} onValueChange={(v) => setForm({ ...form, methodology: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DMAIC">DMAIC</SelectItem>
                  <SelectItem value="DMADV">DMADV (DFSS)</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Champion</Label>
              <Select value={form.champion_id} onValueChange={(v) => setForm({ ...form, champion_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Belt Leader</Label>
              <Select value={form.belt_leader_id} onValueChange={(v) => setForm({ ...form, belt_leader_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Start Date</Label>
              <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div>
              <Label>Target Completion</Label>
              <Input type="date" value={form.target_completion} onChange={(e) => setForm({ ...form, target_completion: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Problem Statement</Label>
              <Textarea value={form.problem_statement} onChange={(e) => setForm({ ...form, problem_statement: e.target.value })} rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Label>Goal Statement</Label>
              <Textarea value={form.goal_statement} onChange={(e) => setForm({ ...form, goal_statement: e.target.value })} rows={2} />
            </div>
            <div className="sm:col-span-2">
              <Label>Scope</Label>
              <Textarea value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} rows={2} />
            </div>
            <div>
              <Label>Baseline Sigma</Label>
              <Input type="number" step="0.01" value={form.baseline_sigma} onChange={(e) => setForm({ ...form, baseline_sigma: e.target.value })} />
            </div>
            <div>
              <Label>Target Sigma</Label>
              <Input type="number" step="0.01" value={form.target_sigma} onChange={(e) => setForm({ ...form, target_sigma: e.target.value })} />
            </div>
            <div>
              <Label>Baseline DPMO</Label>
              <Input type="number" value={form.baseline_dpmo} onChange={(e) => setForm({ ...form, baseline_dpmo: e.target.value })} />
            </div>
            <div>
              <Label>Target DPMO</Label>
              <Input type="number" value={form.target_dpmo} onChange={(e) => setForm({ ...form, target_dpmo: e.target.value })} />
            </div>
            <div>
              <Label>Estimated Savings (₹)</Label>
              <Input type="number" value={form.estimated_savings} onChange={(e) => setForm({ ...form, estimated_savings: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Create Project</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          {selectedProject && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedProject.project_number} — {selectedProject.title}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-muted-foreground">Methodology:</span> {selectedProject.methodology}</div>
                  <div><span className="text-muted-foreground">Priority:</span> {selectedProject.priority}</div>
                  <div><span className="text-muted-foreground">Department:</span> {getDeptName(selectedProject.department_id)}</div>
                  <div><span className="text-muted-foreground">Champion:</span> {getUserName(selectedProject.champion_id)}</div>
                  <div><span className="text-muted-foreground">Belt Leader:</span> {getUserName(selectedProject.belt_leader_id)}</div>
                  <div><span className="text-muted-foreground">Start Date:</span> {selectedProject.start_date || "-"}</div>
                  <div><span className="text-muted-foreground">Target:</span> {selectedProject.target_completion || "-"}</div>
                  <div><span className="text-muted-foreground">Baseline σ:</span> {selectedProject.baseline_sigma || "-"}</div>
                  <div><span className="text-muted-foreground">Current σ:</span> {selectedProject.current_sigma || "-"}</div>
                  <div><span className="text-muted-foreground">Target σ:</span> {selectedProject.target_sigma || "-"}</div>
                  <div><span className="text-muted-foreground">DPMO:</span> {selectedProject.current_dpmo || selectedProject.baseline_dpmo || "-"}</div>
                  <div><span className="text-muted-foreground">Est. Savings:</span> ₹{selectedProject.estimated_savings || 0}</div>
                </div>

                {selectedProject.problem_statement && (
                  <div>
                    <Label className="text-muted-foreground">Problem Statement</Label>
                    <p className="text-sm mt-1">{selectedProject.problem_statement}</p>
                  </div>
                )}
                {selectedProject.goal_statement && (
                  <div>
                    <Label className="text-muted-foreground">Goal Statement</Label>
                    <p className="text-sm mt-1">{selectedProject.goal_statement}</p>
                  </div>
                )}

                {/* Phase Progression */}
                <div>
                  <Label className="text-muted-foreground">Phase Progression</Label>
                  <div className="flex gap-1 mt-2">
                    {(selectedProject.methodology === "DMADV" ? DMADV_PHASES : DMAIC_PHASES).map((phase) => {
                      const isCurrent = selectedProject.current_phase === phase;
                      const phaseIdx = (selectedProject.methodology === "DMADV" ? DMADV_PHASES : DMAIC_PHASES).indexOf(phase);
                      const currentIdx = (selectedProject.methodology === "DMADV" ? DMADV_PHASES : DMAIC_PHASES).indexOf(selectedProject.current_phase);
                      const isPast = phaseIdx < currentIdx;
                      return (
                        <Button
                          key={phase}
                          size="sm"
                          variant={isCurrent ? "default" : isPast ? "secondary" : "outline"}
                          className="flex-1 text-xs capitalize"
                          onClick={() => handleUpdatePhase(selectedProject.id, phase)}
                        >
                          {phase.charAt(0).toUpperCase()}
                        </Button>
                      );
                    })}
                  </div>
                </div>

                {/* Status Update */}
                <div>
                  <Label className="text-muted-foreground">Update Status</Label>
                  <div className="flex gap-2 mt-2">
                    {["active", "on_hold", "completed", "cancelled"].map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={selectedProject.status === s ? "default" : "outline"}
                        className="capitalize text-xs"
                        onClick={() => {
                          handleUpdateStatus(selectedProject.id, s);
                          setSelectedProject({ ...selectedProject, status: s });
                        }}
                      >
                        {s.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                </div>

                {/* Actual Savings Input */}
                <div>
                  <Label className="text-muted-foreground">Actual Savings (₹)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      type="number"
                      defaultValue={selectedProject.actual_savings || ""}
                      id="actual-savings-input"
                    />
                    <Button
                      size="sm"
                      onClick={async () => {
                        const val = (document.getElementById("actual-savings-input") as HTMLInputElement)?.value;
                        await supabase.from("six_sigma_projects").update({ actual_savings: parseFloat(val) || 0 }).eq("id", selectedProject.id);
                        toast.success("Savings updated");
                        fetchData();
                      }}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
