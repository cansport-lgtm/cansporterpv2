import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Package, Plus, Pencil, Trash2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";

interface Material {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  is_active: boolean;
}

const empty = { code: "", name: "", unit: "pcs", category: "", is_active: true };

export default function HPMaterialMasterPage() {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Material | null>(null);
  const [form, setForm] = useState(empty);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["hp-materials"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hp_materials").select("*").order("code");
      if (error) throw error;
      return data as Material[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!form.code.trim() || !form.name.trim()) throw new Error("Code and Name are required");
      const payload = {
        code: form.code.trim(),
        name: form.name.trim(),
        unit: form.unit.trim() || "pcs",
        category: form.category.trim() || null,
        is_active: form.is_active,
      };
      if (editing) {
        const { error } = await supabase.from("hp_materials").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("hp_materials").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hp-materials"] });
      toast.success("Saved");
      setOpen(false);
      setEditing(null);
      setForm(empty);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("hp_materials").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["hp-materials"] });
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
            <p>Only super admins can manage the Material Master.</p>
          </CardContent>
        </Card>
      </ERPLayout>
    );
  }

  return (
    <ERPLayout>
      <PageHeader
        title="HP Material Master"
        description="Materials available for hourly production daily issuance"
        icon={Package}
        action={{ label: "Add Material", icon: Plus, onClick: () => { setEditing(null); setForm(empty); setOpen(true); } }}
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Active</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center">Loading...</TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">No materials yet</TableCell></TableRow>
              ) : rows.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono">{r.code}</TableCell>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell>{r.unit}</TableCell>
                  <TableCell>{r.category || "-"}</TableCell>
                  <TableCell>{r.is_active ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => {
                      setEditing(r);
                      setForm({ code: r.code, name: r.name, unit: r.unit, category: r.category || "", is_active: r.is_active });
                      setOpen(true);
                    }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm("Delete this material?")) remove.mutate(r.id); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Material</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Code *</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} /></div>
            <div><Label>Name *</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Unit</Label><Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} /></div>
              <div><Label>Category</Label><Input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></div>
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
