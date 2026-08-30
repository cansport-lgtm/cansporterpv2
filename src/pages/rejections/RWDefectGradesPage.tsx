import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tag, Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
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
import { useAuth } from "@/contexts/AuthContext";

interface DefectGrade {
  id: string;
  code: string;
  name: string;
  name_urdu: string | null;
  defect_type: string;
  detected_stage: string;
  onward_route: string;
  covered_output_grade_id: string | null;
  is_sellable: boolean;
  sort_order: number;
  is_active: boolean;
}

const ROUTE_LABEL: Record<string, string> = {
  to_store: "Straight to the cheap-ball store",
  cover_then_store: "Covered first, then sold",
  destroy: "Counted only, never stocked",
};

const empty = {
  code: "", name: "", name_urdu: "", defect_type: "rejection", detected_stage: "finished",
  onward_route: "to_store", covered_output_grade_id: "none", is_sellable: true,
  sort_order: 0, is_active: true,
};

export default function RWDefectGradesPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DefectGrade | null>(null);
  const [form, setForm] = useState(empty);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["rw-defect-grades"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_defect_grades").select("*").order("sort_order").order("code");
      if (error) throw error;
      return data as DefectGrade[];
    },
  });

  const byId = useMemo(() => Object.fromEntries(rows.map((r) => [r.id, r])), [rows]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim()) throw new Error("Code is required");
      if (!form.name.trim()) throw new Error("Name is required");
      if (form.onward_route === "cover_then_store" && form.covered_output_grade_id === "none") {
        throw new Error("A grade that is covered before sale must say what it becomes");
      }
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        name_urdu: form.name_urdu.trim() || null,
        defect_type: form.defect_type,
        detected_stage: form.detected_stage,
        onward_route: form.onward_route,
        covered_output_grade_id:
          form.onward_route === "cover_then_store" && form.covered_output_grade_id !== "none"
            ? form.covered_output_grade_id
            : null,
        is_sellable: form.is_sellable,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      };
      const q = editing
        ? (supabase as any).from("rw_defect_grades").update(payload).eq("id", editing.id)
        : (supabase as any).from("rw_defect_grades").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Defect grade updated" : "Defect grade added");
      qc.invalidateQueries({ queryKey: ["rw-defect-grades"] });
      setOpen(false); setEditing(null); setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("rw_defect_grades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["rw-defect-grades"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (r: DefectGrade) => {
    setEditing(r);
    setForm({
      code: r.code, name: r.name, name_urdu: r.name_urdu ?? "",
      defect_type: r.defect_type, detected_stage: r.detected_stage,
      onward_route: r.onward_route,
      covered_output_grade_id: r.covered_output_grade_id ?? "none",
      is_sellable: r.is_sellable, sort_order: r.sort_order, is_active: r.is_active,
    });
    setOpen(true);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Defect Grades"
          description="What class of cheap ball a count produces, and where it goes next"
          icon={Tag}
          iconColor="bg-amber-500 text-white"
        >
          {isSuperAdmin && (
            <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add grade
            </Button>
          )}
        </PageHeader>

        {!isSuperAdmin && (
          <Card>
            <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" /> View only — a super admin maintains this master.
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="py-10 text-center text-sm text-muted-foreground">Loading</div>
            ) : (
              <div className="overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Onward route</TableHead>
                      <TableHead>Becomes</TableHead>
                      <TableHead>Active</TableHead>
                      {isSuperAdmin && <TableHead className="w-24"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono text-xs font-semibold">{r.code}</TableCell>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                          {r.name_urdu && (
                            <div className="text-[11px] text-muted-foreground">{r.name_urdu}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.defect_type === "leakage" ? "info" : "destructive"}>
                            {r.defect_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.detected_stage}</TableCell>
                        <TableCell className="text-sm">{ROUTE_LABEL[r.onward_route] ?? r.onward_route}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {r.covered_output_grade_id ? byId[r.covered_output_grade_id]?.name ?? "—" : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.is_active ? "success" : "secondary"}>
                            {r.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        {isSuperAdmin && (
                          <TableCell>
                            <div className="flex gap-1">
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => startEdit(r)}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost" size="icon" className="h-8 w-8 text-destructive"
                                onClick={() => { if (confirm(`Delete ${r.name}?`)) remove.mutate(r.id); }}
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit defect grade" : "Add defect grade"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Code</Label>
                  <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="REJ_SPOT" />
                </div>
                <div>
                  <Label className="text-xs">Sort order</Label>
                  <Input
                    type="number" value={form.sort_order}
                    onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Name (Urdu)</Label>
                <Input value={form.name_urdu} onChange={(e) => setForm({ ...form, name_urdu: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Type</Label>
                  <Select value={form.defect_type} onValueChange={(v) => setForm({ ...form, defect_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="leakage">Leakage</SelectItem>
                      <SelectItem value="rejection">Rejection</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Detected at</Label>
                  <Select value={form.detected_stage} onValueChange={(v) => setForm({ ...form, detected_stage: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="core">Core (before covering)</SelectItem>
                      <SelectItem value="covered">Covered</SelectItem>
                      <SelectItem value="finished">Finished</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Onward route</Label>
                <Select value={form.onward_route} onValueChange={(v) => setForm({ ...form, onward_route: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="to_store">Straight to the cheap-ball store</SelectItem>
                    <SelectItem value="cover_then_store">Covered first, then sold</SelectItem>
                    <SelectItem value="destroy">Counted only, never stocked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.onward_route === "cover_then_store" && (
                <div>
                  <Label className="text-xs">Becomes, once covered</Label>
                  <Select
                    value={form.covered_output_grade_id}
                    onValueChange={(v) => setForm({ ...form, covered_output_grade_id: v })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {rows
                        .filter((r) => r.onward_route === "to_store" && r.id !== editing?.id)
                        .map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex items-center gap-6 pt-1">
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_sellable} onCheckedChange={(v) => setForm({ ...form, is_sellable: v })} />
                  <Label className="text-sm">Sellable</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                  <Label className="text-sm">Active</Label>
                </div>
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
