import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Boxes, Plus, Pencil, Trash2, ShieldAlert, Info } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";

interface MaterialCost {
  id: string;
  hp_material_id: string;
  unit: string;
  unit_cost: number;
  is_active: boolean;
}

interface HPMaterial {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
}

const empty = { hp_material_id: "", unit: "pcs", unit_cost: "0", is_active: true };

export default function RWMaterialsMasterPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<MaterialCost | null>(null);
  const [form, setForm] = useState(empty);

  const { data: units = [] } = useQuery({
    queryKey: ["rw-units-active"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("rw_units").select("id, symbol, name").eq("is_active", true).order("symbol");
      return (data || []) as any[];
    },
  });

  const { data: hpMaterials = [] } = useQuery({
    queryKey: ["hp-materials-all"],
    queryFn: async () => {
      const { data } = await supabase.from("hp_materials").select("id, name, code, unit").order("name");
      return (data || []) as HPMaterial[];
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["rw-materials-master"],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("rw_materials").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as MaterialCost[];
    },
  });

  const hpMap = useMemo(() => Object.fromEntries(hpMaterials.map(m => [m.id, m])), [hpMaterials]);
  const usedHpIds = useMemo(() => new Set(rows.map(r => r.hp_material_id)), [rows]);

  // For the Add dialog: only hp_materials that don't already have a cost row
  const availableHp = useMemo(
    () => editing
      ? hpMaterials // editing: any selection valid (locked anyway)
      : hpMaterials.filter(m => !usedHpIds.has(m.id)),
    [hpMaterials, usedHpIds, editing]
  );

  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => (hpMap[a.hp_material_id]?.name || "").localeCompare(hpMap[b.hp_material_id]?.name || "")),
    [rows, hpMap]
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!editing && !form.hp_material_id) throw new Error("Pick a material");
      if (!form.unit.trim()) throw new Error("Unit is required");
      const payload: any = {
        unit: form.unit.trim(),
        unit_cost: parseFloat(form.unit_cost) || 0,
        is_active: form.is_active,
      };
      if (editing) {
        const { error } = await (supabase as any).from("rw_materials").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        payload.hp_material_id = form.hp_material_id;
        const { error } = await (supabase as any).from("rw_materials").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rw-materials-master"] });
      qc.invalidateQueries({ queryKey: ["rw-materials"] });
      toast.success("Saved");
      setOpen(false);
      setEditing(null);
      setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("rw_materials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rw-materials-master"] });
      qc.invalidateQueries({ queryKey: ["rw-materials"] });
      toast.success("Deleted");
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (!isSuperAdmin) {
    return (
      <ERPLayout>
        <Card>
          <CardContent className="p-10 text-center">
            <ShieldAlert className="h-10 w-10 mx-auto mb-2 text-amber-500" />
            <p>Only super admins can manage the Materials Master.</p>
          </CardContent>
        </Card>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <PageHeader
        title="Materials Master"
        description="Set unit and unit cost for Hourly Production materials used in Rejections, Wastages & Leakages"
        icon={Boxes}
        action={{ label: "Add Material Cost", icon: Plus, onClick: () => { setEditing(null); setForm(empty); setOpen(true); } }}
      />

      <Card className="border-amber-200 bg-amber-50/50 mb-3">
        <CardContent className="p-3 flex gap-2 items-start text-xs text-amber-900">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            Material names come from the <strong>Hourly Production materials</strong> list. To add or rename a material, edit it there. This page only sets the <strong>unit</strong> and <strong>unit cost</strong> used by R&amp;W entries.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Material</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Unit Cost (Rs.)</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
              ) : sortedRows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No materials yet</TableCell></TableRow>
              ) : sortedRows.map(r => {
                const hp = hpMap[r.hp_material_id];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{hp?.code || "—"}</TableCell>
                    <TableCell className="font-medium">{hp?.name || <span className="text-destructive">Missing</span>}</TableCell>
                    <TableCell>{r.unit}</TableCell>
                    <TableCell className="text-right">{Number(r.unit_cost).toLocaleString()}</TableCell>
                    <TableCell>{r.is_active ? "Yes" : "No"}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => {
                        setEditing(r);
                        setForm({
                          hp_material_id: r.hp_material_id,
                          unit: r.unit,
                          unit_cost: String(r.unit_cost ?? 0),
                          is_active: r.is_active,
                        });
                        setOpen(true);
                      }}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this material cost?")) remove.mutate(r.id); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Material Cost" : "Add Material Cost"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Material *</Label>
              {editing ? (
                <Input value={hpMap[form.hp_material_id]?.name || ""} disabled />
              ) : (
                <Select value={form.hp_material_id || undefined} onValueChange={v => {
                  const hp = hpMap[v];
                  setForm({ ...form, hp_material_id: v, unit: hp?.unit || form.unit });
                }}>
                  <SelectTrigger><SelectValue placeholder={availableHp.length ? "Pick a material" : "All materials already added"} /></SelectTrigger>
                  <SelectContent>
                    {availableHp.map(m => (
                      <SelectItem key={m.id} value={m.id}>{m.name}{m.code ? ` (${m.code})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Unit *</Label>
                <Select value={form.unit} onValueChange={v => setForm({ ...form, unit: v })}>
                  <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                  <SelectContent>
                    {units.length === 0 && <SelectItem value="pcs">pcs</SelectItem>}
                    {units.map((u: any) => <SelectItem key={u.id} value={u.symbol}>{u.symbol}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Unit Cost (Rs.) *</Label>
                <Input type="number" inputMode="decimal" value={form.unit_cost} onChange={e => setForm({ ...form, unit_cost: e.target.value })} />
              </div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} /><Label>Active</Label></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
