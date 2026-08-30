import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Boxes, Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
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

interface Location {
  id: string;
  code: string;
  name: string;
  name_urdu: string | null;
  location_type: string;
  department_id: string | null;
  is_active: boolean;
}

const TYPE_LABEL: Record<string, string> = {
  floor_bin: "Floor bin",
  leaker_wip: "Leaker WIP",
  transit: "In transit",
  store: "Store",
};

const empty = {
  code: "", name: "", name_urdu: "", location_type: "floor_bin",
  department_id: "none", is_active: true,
};

export default function RWLocationsPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState(empty);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["rw-locations"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("rw_locations").select("*").order("code");
      if (error) throw error;
      return data as Location[];
    },
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["rw-loc-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments").select("id, name").eq("is_active", true).order("name");
      return (data || []) as { id: string; name: string }[];
    },
  });

  const deptName = (id: string | null) =>
    id ? departments.find((d) => d.id === id)?.name ?? "—" : "—";

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim()) throw new Error("Code is required");
      if (!form.name.trim()) throw new Error("Name is required");
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        name_urdu: form.name_urdu.trim() || null,
        location_type: form.location_type,
        department_id: form.department_id !== "none" ? form.department_id : null,
        is_active: form.is_active,
      };
      const q = editing
        ? (supabase as any).from("rw_locations").update(payload).eq("id", editing.id)
        : (supabase as any).from("rw_locations").insert(payload);
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(editing ? "Location updated" : "Location added");
      qc.invalidateQueries({ queryKey: ["rw-locations"] });
      setOpen(false); setEditing(null); setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("rw_locations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["rw-locations"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const startEdit = (r: Location) => {
    setEditing(r);
    setForm({
      code: r.code, name: r.name, name_urdu: r.name_urdu ?? "",
      location_type: r.location_type, department_id: r.department_id ?? "none",
      is_active: r.is_active,
    });
    setOpen(true);
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="R&W Locations"
          description="Floor bins, the leaker-WIP holding point, transit and the cheap-ball store"
          icon={Boxes}
          iconColor="bg-primary text-primary-foreground"
        >
          {isSuperAdmin && (
            <Button onClick={() => { setEditing(null); setForm(empty); setOpen(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Add location
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
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Department</TableHead>
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
                          <Badge variant={r.location_type === "leaker_wip" ? "warning" : "secondary"}>
                            {TYPE_LABEL[r.location_type] ?? r.location_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {deptName(r.department_id)}
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
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit location" : "Add location"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label className="text-xs">Code</Label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="LF-CHEAP" />
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Name (Urdu)</Label>
                <Input value={form.name_urdu} onChange={(e) => setForm({ ...form, name_urdu: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={form.location_type} onValueChange={(v) => setForm({ ...form, location_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="floor_bin">Floor bin</SelectItem>
                    <SelectItem value="leaker_wip">Leaker WIP</SelectItem>
                    <SelectItem value="transit">In transit</SelectItem>
                    <SelectItem value="store">Store</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not department-specific</SelectItem>
                    {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
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
