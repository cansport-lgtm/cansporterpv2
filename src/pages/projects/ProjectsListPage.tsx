import { useEffect, useMemo, useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Plus, Search, Edit, Eye, Trash2, Printer, ChevronDown, LayoutGrid } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
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
  department_id: string | null;
  category_id: string | null;
  project_manager_id: string | null;
  budget_estimated: number | null;
  budget_actual: number | null;
  methodology: string | null;
  created_at: string | null;
}

interface Department {
  id: string;
  name: string;
}

interface Category {
  id: string;
  name: string;
  is_active: boolean;
}

interface AppUser {
  id: string;
  full_name: string;
}

const STATUSES = ["planned", "in_progress", "on_hold", "completed", "cancelled"];
const PRIORITIES = ["low", "medium", "high", "critical"];
const UNCATEGORIZED = "none";
type ViewMode = "grouped" | "board" | "flat";

const readStorage = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const writeStorage = (key: string, value: string) => {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
};

export default function ProjectsListPage() {
  const { user, hasRole } = useAuth();
  const isSuperAdmin = hasRole('super_admin');
  // super_admin and Projects Super Manager see every project; everyone else only their own
  const canViewAllProjects = hasRole('projects_super_manager');
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>(() => {
    const v = readStorage("projects-list-view");
    return v === "board" || v === "flat" ? v : "grouped";
  });
  const [collapsed, setCollapsed] = useState<string[]>(() => {
    try { return JSON.parse(readStorage("projects-list-collapsed") || "[]"); } catch { return []; }
  });

  const [form, setForm] = useState({
    title: "",
    description: "",
    status: "planned",
    priority: "medium",
    start_date: "",
    target_end_date: "",
    department_id: "",
    category_id: "",
    project_manager_id: "",
    budget_estimated: "",
    methodology: "",
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    let projQuery = supabase.from("projects").select("*").order("created_at", { ascending: false });
    if (!canViewAllProjects && user) {
      projQuery = projQuery.eq("project_manager_id", user.id);
    }
    const [projRes, deptRes, catRes, userRes] = await Promise.all([
      projQuery,
      supabase.from("production_departments").select("id, name").eq("is_active", true),
      supabase.from("project_categories").select("id, name, is_active").order("sequence_order").order("name"),
      supabase.from("app_users").select("id, full_name").eq("is_active", true),
    ]);
    setProjects(projRes.data || []);
    setDepartments(deptRes.data || []);
    setCategories(catRes.data || []);
    setUsers(userRes.data || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingProject(null);
    setForm({
      title: "", description: "", status: "planned", priority: "medium",
      start_date: "", target_end_date: "", department_id: "", category_id: "", project_manager_id: "",
      budget_estimated: "", methodology: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (p: Project) => {
    setEditingProject(p);
    setForm({
      title: p.title,
      description: p.description || "",
      status: p.status,
      priority: p.priority,
      start_date: p.start_date || "",
      target_end_date: p.target_end_date || "",
      department_id: p.department_id || "",
      category_id: p.category_id || "",
      project_manager_id: p.project_manager_id || "",
      budget_estimated: p.budget_estimated?.toString() || "",
      methodology: p.methodology || "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      toast.error("Title is required");
      return;
    }

    const payload: any = {
      title: form.title,
      description: form.description || null,
      status: form.status,
      priority: form.priority,
      start_date: form.start_date || null,
      target_end_date: form.target_end_date || null,
      department_id: form.department_id || null,
      category_id: form.category_id || null,
      project_manager_id: form.project_manager_id || null,
      budget_estimated: form.budget_estimated ? parseFloat(form.budget_estimated) : 0,
      methodology: form.methodology || null,
    };

    if (form.status === "completed" && !editingProject?.actual_end_date) {
      payload.actual_end_date = new Date().toISOString().split("T")[0];
    }

    if (editingProject) {
      const { error } = await supabase.from("projects").update(payload).eq("id", editingProject.id);
      if (error) { toast.error("Failed to update project"); return; }
      toast.success("Project updated");
    } else {
      payload.project_number = "";
      const { error } = await supabase.from("projects").insert(payload);
      if (error) { toast.error("Failed to create project"); return; }
      toast.success("Project created");
    }

    setDialogOpen(false);
    loadData();
  };

  const filtered = projects.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (categoryFilter !== "all" && (categoryFilter === UNCATEGORIZED ? p.category_id : p.category_id !== categoryFilter)) return false;
    if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.project_number.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });


  const changeView = (v: ViewMode) => { setView(v); writeStorage("projects-list-view", v); };
  const saveCollapsed = (next: string[]) => { setCollapsed(next); writeStorage("projects-list-collapsed", JSON.stringify(next)); };
  const toggleGroup = (key: string) =>
    saveCollapsed(collapsed.includes(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key]);

  // Group the already-filtered projects by category. Admin-defined category order first, Uncategorized last.
  const groups = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const byKey = new Map<string, Project[]>();
    filtered.forEach((p) => {
      const key = p.category_id && known.has(p.category_id) ? p.category_id : UNCATEGORIZED;
      byKey.set(key, [...(byKey.get(key) || []), p]);
    });
    const ordered = categories
      .filter((c) => byKey.has(c.id))
      .map((c) => ({ key: c.id, name: c.name, items: byKey.get(c.id)! }));
    if (byKey.has(UNCATEGORIZED)) ordered.push({ key: UNCATEGORIZED, name: "Uncategorized", items: byKey.get(UNCATEGORIZED)! });
    return ordered;
  }, [filtered, categories]);

  // Tiles ignore the category filter so they stay visible and clickable
  const tiles = useMemo(() => {
    const known = new Set(categories.map((c) => c.id));
    const base = projects.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (search && !p.title.toLowerCase().includes(search.toLowerCase()) && !p.project_number.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
    const list = categories.map((c) => ({ key: c.id, name: c.name, items: base.filter((p) => p.category_id === c.id) }));
    list.push({ key: UNCATEGORIZED, name: "Uncategorized", items: base.filter((p) => !p.category_id || !known.has(p.category_id)) });
    return list.filter((t) => t.items.length > 0);
  }, [projects, categories, statusFilter, search]);

  const statusMix = (items: Project[]) => {
    const mix: Record<string, number> = {};
    items.forEach((p) => { mix[p.status] = (mix[p.status] || 0) + 1; });
    return Object.entries(mix);
  };

  const statusColor: Record<string, string> = {
    planned: "bg-blue-100 text-blue-800",
    in_progress: "bg-yellow-100 text-yellow-800",
    on_hold: "bg-gray-100 text-gray-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
  };

  const priorityColor: Record<string, string> = {
    low: "bg-gray-100 text-gray-700",
    medium: "bg-blue-100 text-blue-700",
    high: "bg-orange-100 text-orange-700",
    critical: "bg-red-100 text-red-700",
  };


  const renderRow = (p: Project, showCategory: boolean) => (
    <tr key={p.id} className="border-b hover:bg-muted/50">
      <td className="p-2 font-mono text-xs">{p.project_number}</td>
      <td className="p-2 font-medium">{p.title}</td>
      {showCategory && <td className="p-2 text-xs">{categories.find((c) => c.id === p.category_id)?.name || "-"}</td>}
      <td className="p-2">
        <Badge variant="outline" className={statusColor[p.status]}>{p.status.replace("_", " ")}</Badge>
      </td>
      <td className="p-2"><Badge variant="secondary" className={priorityColor[p.priority] || ""}>{p.priority}</Badge></td>
      <td className="p-2 text-xs">{p.start_date ? format(new Date(p.start_date), "dd MMM yy") : "-"}</td>
      <td className="p-2 text-xs">{p.target_end_date ? format(new Date(p.target_end_date), "dd MMM yy") : "-"}</td>
      <td className="p-2 text-xs">{users.find((u) => u.id === p.project_manager_id)?.full_name || "-"}</td>
      <td className="p-2">
        <div className="flex gap-1">
          <Button variant="outline" size="sm" className="h-8 px-2 text-primary border-primary/40" title="Open Kanban board"
            onClick={() => navigate(`/projects/kanban?project=${p.id}`)}>
            <LayoutGrid className="h-4 w-4 sm:mr-1" /><span className="hidden sm:inline">Board</span>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(`/projects/${p.id}`)}><Eye className="h-4 w-4" /></Button>
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" onClick={() => openEdit(p)}><Edit className="h-4 w-4" /></Button>
          )}
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" onClick={() => setDeleteId(p.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          )}
        </div>
      </td>
    </tr>
  );

  const renderTable = (items: Project[], showCategory: boolean) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="p-2">Project #</th>
            <th className="p-2">Title</th>
            {showCategory && <th className="p-2">Category</th>}
            <th className="p-2">Status</th>
            <th className="p-2">Priority</th>
            <th className="p-2">Start</th>
            <th className="p-2">Target End</th>
            <th className="p-2">Manager</th>
            <th className="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>{items.map((p) => renderRow(p, showCategory))}</tbody>
      </table>
    </div>
  );

  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.includes(g.key));

  return (
    <ERPLayout>
      <PageHeader title="Projects List" description="Manage all manufacturing projects">
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4 mr-1" /> Print</Button>
          )}
          <Button onClick={openCreate} size="sm"><Plus className="h-4 w-4 mr-1" /> New Project</Button>
        </div>
      </PageHeader>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search projects..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="none">Uncategorized</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex rounded-md border p-0.5 gap-0.5" role="group" aria-label="View">
              {(["grouped", "board", "flat"] as ViewMode[]).map((v) => (
                <Button key={v} type="button" size="sm" variant={view === v ? "secondary" : "ghost"} aria-pressed={view === v}
                  className="capitalize" onClick={() => changeView(v)}>{v}</Button>
              ))}
            </div>
            {view === "grouped" && (
              <Button type="button" variant="outline" size="sm" onClick={() => saveCollapsed(allCollapsed ? [] : groups.map((g) => g.key))}>
                {allCollapsed ? "Expand all" : "Collapse all"}
              </Button>
            )}
          </div>

          {!loading && tiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4 print:hidden">
              {tiles.map((t) => (
                <button key={t.key} type="button" aria-pressed={categoryFilter === t.key}
                  onClick={() => setCategoryFilter(categoryFilter === t.key ? "all" : t.key)}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm hover:bg-muted/50 ${categoryFilter === t.key ? "border-primary bg-primary/5" : ""}`}>
                  <span className="text-muted-foreground">{t.name}</span>
                  <span className="font-semibold">{t.items.length}</span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No projects found.</p>
          ) : view === "flat" ? (
            renderTable(filtered, true)
          ) : view === "board" ? (
            <div className="flex gap-3 overflow-x-auto pb-2">
              {groups.map((g) => (
                <div key={g.key} className="min-w-[270px] w-[270px] shrink-0 rounded-lg border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">{g.name}</h3>
                    <Badge variant="secondary">{g.items.length}</Badge>
                  </div>
                  {g.items.map((p) => (
                    <div key={p.id} className="rounded-md border bg-background p-2.5 space-y-1.5 cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/projects/${p.id}`)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-muted-foreground">{p.project_number}</span>
                        <Badge variant="secondary" className={priorityColor[p.priority] || ""}>{p.priority}</Badge>
                      </div>
                      <div className="text-sm font-medium">{p.title}</div>
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className={statusColor[p.status]}>{p.status.replace("_", " ")}</Badge>
                        <span className="text-xs text-muted-foreground truncate">{users.find((u) => u.id === p.project_manager_id)?.full_name || "No manager"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {groups.map((g) => {
                const isOpen = !collapsed.includes(g.key);
                return (
                  <section key={g.key} className="rounded-lg border overflow-hidden print:break-inside-avoid">
                    <button type="button" aria-expanded={isOpen} onClick={() => toggleGroup(g.key)}
                      className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-muted/50">
                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                      <span className="font-semibold">{g.name}</span>
                      <Badge variant="secondary">{g.items.length}</Badge>
                      <span className="ml-auto flex flex-wrap gap-1.5">
                        {statusMix(g.items).map(([status, n]) => (
                          <Badge key={status} variant="outline" className={statusColor[status]}>{n} {status.replace("_", " ")}</Badge>
                        ))}
                      </span>
                    </button>
                    {/* Collapsed groups stay in the DOM so Print always shows every category */}
                    <div className={`border-t ${isOpen ? "" : "hidden print:block"}`}>{renderTable(g.items, false)}</div>
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingProject ? "Edit Project" : "New Project"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Start Date</Label>
                <Input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label>Target End Date</Label>
                <Input type="date" value={form.target_end_date} onChange={(e) => setForm({ ...form, target_end_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category_id} onValueChange={(v) => setForm({ ...form, category_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories
                    .filter((c) => c.is_active || c.id === form.category_id)
                    .map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.is_active ? "" : " (inactive)"}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project Manager</Label>
              <Select value={form.project_manager_id} onValueChange={(v) => setForm({ ...form, project_manager_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select manager" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estimated Budget</Label>
              <Input type="number" value={form.budget_estimated} onChange={(e) => setForm({ ...form, budget_estimated: e.target.value })} />
            </div>
            <div>
              <Label>Methodology</Label>
              <Input value={form.methodology} onChange={(e) => setForm({ ...form, methodology: e.target.value })} placeholder="e.g., Lean, Six Sigma, Agile" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingProject ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Project?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently delete the project and all its tasks, documents, and data. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={async () => {
              if (!deleteId) return;
              // Delete related records first
              await supabase.from("project_tasks").delete().eq("project_id", deleteId);
              await supabase.from("project_documents").delete().eq("project_id", deleteId);
              const { error } = await supabase.from("projects").delete().eq("id", deleteId);
              if (error) { toast.error("Failed to delete project"); } else { toast.success("Project deleted"); loadData(); }
              setDeleteId(null);
            }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
