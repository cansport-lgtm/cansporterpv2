import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Plus, Pencil, Trash2, ShieldAlert, Info } from "lucide-react";
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

interface Checkpoint {
  id: string;
  department_id: string;
  defect_grade_id: string;
  location_id: string;
  sort_order: number;
  is_active: boolean;
}

const empty = {
  department_id: "", defect_grade_id: "", location_id: "", sort_order: 0, is_active: true,
};

export default function RWCheckpointsPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Checkpoint | null>(null);
  const [form, setForm] = useState(empty);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["rw-checkpoints-all"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_department_defect_grades").select("*").order("sort_order");
      if (error) throw error;
      return data as Checkpoint[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["rw-cp-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments").select("id, name").eq("is_active", true).order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["rw-cp-grades"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_defect_grades").select("id, code, name, onward_route").eq("is_active", true).order("sort_order");
      return (data || []) as { id: string; code: string; name: string; onward_route: string }[];
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["rw-cp-locations"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("rw_locations").select("id, code, name, location_type").eq("is_active", true).order("code");
      return (data || []) as { id: string; code: string; name: string; location_type: string }[];
    },
  });

  const deptMap = useMemo(() => Object.fromEntries(departments.map((d) => [d.id, d])), [departments]);
  const gradeMap = useMemo(() => Object.fromEntries(grades.map((g) => [g.id, g])), [grades]);
  const locMap = useMemo(() => Object.fromEntries(locations.map((l) => [l.id, l])), [locations]);

  const grouped = useMemo(() => {
    const m = new Map<string, Checkpoint[]>();
    for (const r of rows) {
      const arr = m.get(r.department_id) ?? [];
      arr.push(r);
      m.set(r.department_id, arr);
    }
    return [...m.entries()]
      .map(([deptId, list]) => ({
        deptId,
        name: deptMap[deptId]?.name ?? "Unknown department",
        list: list.sort((a, b) => a.sort_order - b.sort_order),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, deptMap]);

  const save = useMutation({
    mutationFn: async () => {
      if (!form.department_id) throw new Error("Pick a department");
      if (!form.defect_grade_id) throw new Error("Pick a defect grade");
      if (!form.location_id) throw new Error("Pick the bin it goes into");
      const payload = {
        department_id: form.department_id,
        defect_grade_id: form.defect_grade_id,
        location_id: form.location_id,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      };
      const q = editing
        ? (supabase as any).from("rw_department_defect_grades").update(payload).eq("id", editing.id)
        : (supabase as any).from("rw_department_defect_grades").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Checkpoint updated" : "Checkpoint added");
      qc.invalidateQueries({ queryKey: ["rw-checkpoints-all"] });
      qc.invalidateQueries({ queryKey: ["rw-checkpoints"] });
      qc.invalidateQueries({ queryKey: ["rw-checker-departments"] });
      setOpen(false); setEditing(null); setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("rw_department_defect_grades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["rw-checkpoints-all"] });
      qc.invalidateQueries({ queryKey: ["rw-checker-departments"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (r: Checkpoint) => {
    setEditing(r);
    setForm({
      department_id: r.department_id, defect_grade_id: r.defect_grade_id,
      location_id: r.location_id, sort_order: r.sort_order, is_active: r.is_active,
    });
    setOpen(true);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Department Checkpoints"
          description="Which department counts which defect grade, and into which bin"
          icon={ClipboardCheck}
          iconColor="bg-amber-500 text-white"
        >
          {isSuperAdmin && (
            <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add checkpoint
            </Button>
          )}
        </PageHeader>

        <div className="flex items-start gap-2 rounded-lg bg-sky-500/[0.06] ring-1 ring-inset ring-sky-500/20 px-3 py-2 text-[12.5px] text-sky-900 dark:text-sky-200">
          <Info className="h-4 w-4 text-sky-500 shrink-0 mt-0.5" />
          <span>
            This decides the columns on the checker's screen and resolves the destination bin, so the
            checker never picks a location. It also scopes the daily coverage check — a department
            with no checkpoint here is never asked for a count.
          </span>
        </div>

        {!isSuperAdmin && (
          <Card>
            <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
              <ShieldAlert className="h-4 w-4" /> View only — a super admin maintains this master.
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Loading</CardContent></Card>
        ) : (
          grouped.map((g) => (
            <Card key={g.deptId}>
              <CardContent className="p-0">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <div className="font-display font-semibold">{g.name}</div>
                  <Badge variant="soft">{g.list.length} grade{g.list.length > 1 ? "s" : ""} counted</Badge>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[620px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Defect grade</TableHead>
                        <TableHead>Goes into</TableHead>
                        <TableHead className="w-24">Order</TableHead>
                        <TableHead>Active</TableHead>
                        {isSuperAdmin && <TableHead className="w-24"></TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {g.list.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="font-medium">{gradeMap[r.defect_grade_id]?.name ?? "—"}</div>
                            {gradeMap[r.defect_grade_id]?.onward_route === "cover_then_store" && (
                              <div className="text-[11px] text-muted-foreground">
                                held as WIP until covered
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs font-semibold">
                              {locMap[r.location_id]?.code ?? "—"}
                            </span>
                            <span className="text-[11px] text-muted-foreground ml-2">
                              {locMap[r.location_id]?.name}
                            </span>
                          </TableCell>
                          <TableCell className="tabular-nums text-muted-foreground">{r.sort_order}</TableCell>
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
                                  onClick={() => { if (confirm("Delete this checkpoint?")) remove.mutate(r.id); }}
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
              </CardContent>
            </Card>
          ))
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit checkpoint" : "Add checkpoint"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Defect grade counted here</Label>
                <Select value={form.defect_grade_id} onValueChange={(v) => setForm({ ...form, defect_grade_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a grade" /></SelectTrigger>
                  <SelectContent>
                    {grades.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Bin it goes into</Label>
                <Select value={form.location_id} onValueChange={(v) => setForm({ ...form, location_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick a bin" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Column order on the checker grid</Label>
                <Input
                  type="number" value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
                />
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
