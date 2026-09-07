import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Workflow, Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { QsProcess, useQsProcesses } from "@/components/quality-score/qsShared";

const emptyForm = {
  name: "",
  description: "",
  department_id: "all",
  sort_order: 0,
  is_active: true,
};

// Master list of production processes inspectors can pick when submitting a
// Process Quality score. A process tied to a department only shows on the entry
// form when that department is selected; "All departments" processes always show.
export default function QSProcessMasterPage() {
  const qc = useQueryClient();
  const { hasRole, hasModulePermission } = useAuth();
  const canManage = hasRole("super_admin") || hasModulePermission("quality_score", "approve");

  const { data: processes = [], isLoading } = useQsProcesses();

  const { data: departments = [] } = useQuery({
    queryKey: ["qs-lookup-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments").select("id, name").eq("is_active", true).order("name");
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });
  const departmentName = (id: string | null) =>
    id ? departments.find((d) => d.id === id)?.name ?? "—" : "All departments";

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<QsProcess | null>(null);
  const [form, setForm] = useState(emptyForm);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        department_id: form.department_id !== "all" ? form.department_id : null,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
        updated_at: new Date().toISOString(),
      };
      const q = editing
        ? (supabase as any).from("qs_processes").update(payload).eq("id", editing.id)
        : (supabase as any).from("qs_processes").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Process updated" : "Process added");
      qc.invalidateQueries({ queryKey: ["qs-processes"] });
      setOpen(false); setEditing(null); setForm(emptyForm);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("qs_processes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Process deleted");
      qc.invalidateQueries({ queryKey: ["qs-processes"] });
    },
    onError: () =>
      toast.error("Cannot delete a process that already has scores — deactivate it instead"),
  });

  const startEdit = (p: QsProcess) => {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      department_id: p.department_id ?? "all",
      sort_order: p.sort_order,
      is_active: p.is_active,
    });
    setOpen(true);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-4xl space-y-4">
        <PageHeader
          title="Quality Score — Process Master"
          description="Production processes inspectors can pick when submitting a Process Quality score"
          icon={Workflow}
        >
          {canManage && (
            <Button onClick={() => { setEditing(null); setForm(emptyForm); setOpen(true); }}>
              <Plus className="mr-2 h-4 w-4" /> Add Process
            </Button>
          )}
        </PageHeader>

        {!canManage && (
          <Card>
            <CardContent className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" /> View only — a Quality Score manager or super admin maintains this master.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
            ) : processes.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No processes yet — add the processes your inspectors assess (e.g. Hand Stitching, Moulding)
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[700px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Process</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Status</TableHead>
                      {canManage && <TableHead className="w-24"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {processes.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.name}</TableCell>
                        <TableCell className="max-w-md text-sm text-muted-foreground">
                          {p.description ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm">{departmentName(p.department_id)}</TableCell>
                        <TableCell>
                          <Badge variant={p.is_active ? "success" : "secondary"}>
                            {p.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {canManage && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(p)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                                onClick={() => { if (confirm(`Delete ${p.name}?`)) remove.mutate(p.id); }}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit process" : "Add process"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Name</Label>
                <Input
                  value={form.name} placeholder="Hand Stitching"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Department</Label>
                  <Select
                    value={form.department_id}
                    onValueChange={(v) => setForm({ ...form, department_id: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All departments</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Sort order</Label>
                  <Input
                    type="number" value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label className="text-sm">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
