import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search, Gauge, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { MPH_LOSS_CATEGORIES, type MphLossReason } from "@/lib/mphLoss";

interface ReasonDepartment {
  reason_id: string;
  department_id: string;
}

const emptyForm = {
  name: "",
  category: "Labour",
  description: "",
  applies_to_all: true,
  is_active: true,
  sort_order: 0,
};

// MPH loss reason master. Super admin only (the route, the sidebar and the
// table's row-level security all say so).
export default function MPHLossReasonsMasterPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MphLossReason | null>(null);
  const [toDelete, setToDelete] = useState<MphLossReason | null>(null);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [form, setForm] = useState(emptyForm);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);

  const { data: reasons = [] } = useQuery({
    queryKey: ["mph-loss-reasons"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("mph_loss_reasons")
        .select("*")
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return (data || []) as MphLossReason[];
    },
  });

  const { data: mapping = [] } = useQuery({
    queryKey: ["mph-loss-reason-departments"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("mph_loss_reason_departments").select("*");
      if (error) throw error;
      return (data || []) as ReasonDepartment[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const deptName = useMemo(() => Object.fromEntries(departments.map((d) => [d.id, d.name])), [departments]);
  const deptsByReason = useMemo(() => {
    const map: Record<string, string[]> = {};
    mapping.forEach((m) => (map[m.reason_id] ??= []).push(m.department_id));
    return map;
  }, [mapping]);

  const resetForm = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setSelectedDepts([]);
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ ...emptyForm, sort_order: reasons.length + 1 });
    setSelectedDepts([]);
    setDialogOpen(true);
  };

  const openEdit = (r: MphLossReason) => {
    setEditing(r);
    setForm({
      name: r.name,
      category: r.category || "Other",
      description: r.description || "",
      applies_to_all: r.applies_to_all,
      is_active: r.is_active,
      sort_order: r.sort_order,
    });
    setSelectedDepts(deptsByReason[r.id] || []);
    setDialogOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        category: form.category || null,
        description: form.description.trim() || null,
        applies_to_all: form.applies_to_all,
        is_active: form.is_active,
        sort_order: Number(form.sort_order) || 0,
      };
      let reasonId = editing?.id;
      if (editing) {
        const { error } = await (supabase as any).from("mph_loss_reasons").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from("mph_loss_reasons")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        reasonId = data.id;
      }

      const { error: delError } = await (supabase as any)
        .from("mph_loss_reason_departments")
        .delete()
        .eq("reason_id", reasonId);
      if (delError) throw delError;
      if (!form.applies_to_all && selectedDepts.length > 0) {
        const { error } = await (supabase as any)
          .from("mph_loss_reason_departments")
          .insert(selectedDepts.map((department_id) => ({ reason_id: reasonId, department_id })));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mph-loss-reasons"] });
      qc.invalidateQueries({ queryKey: ["mph-loss-reason-departments"] });
      toast.success(editing ? "Reason updated" : "Reason added");
      resetForm();
    },
    onError: (e: any) =>
      toast.error(e.code === "23505" ? "A reason with this name already exists" : e.message || "Failed to save"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data: used } = await (supabase as any)
        .from("mph_loss_report_lines")
        .select("id")
        .eq("reason_id", id)
        .limit(1);
      if (used && used.length > 0) {
        throw new Error("This reason is used in MPH loss reports. Deactivate it instead.");
      }
      const { error } = await (supabase as any).from("mph_loss_reasons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mph-loss-reasons"] });
      toast.success("Reason deleted");
      setToDelete(null);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Reason name is required");
      return;
    }
    if (!form.applies_to_all && selectedDepts.length === 0) {
      toast.error("Pick at least one department, or tick All departments");
      return;
    }
    saveMutation.mutate();
  };

  const toggleDept = (id: string) =>
    setSelectedDepts((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));

  const filtered = reasons.filter((r) => {
    const q = search.toLowerCase();
    if (q && !`${r.code} ${r.name} ${r.category ?? ""}`.toLowerCase().includes(q)) return false;
    if (statusFilter === "active" && !r.is_active) return false;
    if (statusFilter === "inactive" && r.is_active) return false;
    if (departmentFilter !== "all" && !r.applies_to_all && !(deptsByReason[r.id] || []).includes(departmentFilter)) {
      return false;
    }
    return true;
  });

  const columns = [
    { key: "code", header: "Code", render: (r: MphLossReason) => <span className="font-mono text-sm">{r.code}</span> },
    {
      key: "name",
      header: "Reason",
      render: (r: MphLossReason) => (
        <div>
          <div className="font-medium">{r.name}</div>
          {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (r: MphLossReason) => (r.category ? <Badge variant="secondary">{r.category}</Badge> : "—"),
    },
    {
      key: "departments",
      header: "Applies to departments",
      render: (r: MphLossReason) => {
        if (r.applies_to_all) return <Badge variant="outline">All departments</Badge>;
        const list = deptsByReason[r.id] || [];
        return (
          <div className="flex flex-wrap gap-1 max-w-md">
            {list.map((id) => (
              <Badge key={id} variant="outline" className="text-xs border-indigo-200 bg-indigo-50 text-indigo-800">
                {deptName[id] || "—"}
              </Badge>
            ))}
          </div>
        );
      },
    },
    {
      key: "is_active",
      header: "Status",
      render: (r: MphLossReason) => (
        <Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (r: MphLossReason) =>
        isSuperAdmin ? (
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Edit" aria-label="Edit reason">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setToDelete(r)} title="Delete" aria-label="Delete reason">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="MPH Loss Reasons"
        description="Reasons the Production Coordinator picks when a department loses MPH. Super admin only."
        icon={Gauge}
        iconColor="bg-red-600 text-white"
        action={isSuperAdmin ? { label: "Add Reason", onClick: openAdd, icon: Plus } : undefined}
      />

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search code or reason..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 w-[260px]"
          />
        </div>
        <Select value={departmentFilter} onValueChange={setDepartmentFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Badge className="bg-violet-100 text-violet-700 hover:bg-violet-100 gap-1 h-7">
          <Lock className="h-3 w-3" /> Super Admin only
        </Badge>
      </div>

      <DataTable columns={columns} data={filtered} emptyMessage="No MPH loss reasons yet" />

      <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : resetForm())}>
        <DialogContent className="max-w-lg max-h-[90vh] w-[95vw] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit Reason ${editing.code}` : "Add Reason"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex-1 overflow-hidden flex flex-col">
            <ScrollArea className="flex-1 pr-3">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="mlr-name">Reason name *</Label>
                  <Input
                    id="mlr-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Power shutdown"
                    required
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Category</Label>
                    <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MPH_LOSS_CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="mlr-order">Sort order</Label>
                    <Input
                      id="mlr-order"
                      type="number"
                      value={form.sort_order}
                      onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="mlr-desc">Description</Label>
                  <Textarea
                    id="mlr-desc"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="What this reason covers"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="mlr-all"
                      checked={form.applies_to_all}
                      onCheckedChange={(c) => setForm({ ...form, applies_to_all: c === true })}
                    />
                    <Label htmlFor="mlr-all">All departments</Label>
                  </div>
                  {!form.applies_to_all && (
                    <div className="border rounded-md p-3 max-h-64 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-2 bg-muted/20">
                      {departments.map((d) => (
                        <div key={d.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`mlr-d-${d.id}`}
                            checked={selectedDepts.includes(d.id)}
                            onCheckedChange={() => toggleDept(d.id)}
                          />
                          <Label htmlFor={`mlr-d-${d.id}`} className="font-normal cursor-pointer">{d.name}</Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c })} />
                  <Label>Active</Label>
                </div>
              </div>
            </ScrollArea>
            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save Reason"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete reason?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.code} · {toDelete?.name}. A reason already used in a report can only be deactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && deleteMutation.mutate(toDelete.id)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
