import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, ListChecks } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export default function RejectionWastageReasonsPage() {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", type: "rejection", category: "", is_active: true });

  const { data: reasons = [], refetch } = useQuery({
    queryKey: ["rw-reasons"],
    queryFn: async () => {
      const { data } = await supabase.from("rw_reasons").select("*").order("type").order("name");
      return data || [];
    },
  });

  const openNew = () => {
    setEditing(null);
    setForm({ name: "", type: "rejection", category: "", is_active: true });
    setOpen(true);
  };

  const openEdit = (r: any) => {
    setEditing(r);
    setForm({ name: r.name, type: r.type, category: r.category || "", is_active: r.is_active });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) return toast({ title: "Name required", variant: "destructive" });
    const payload = { ...form, category: form.category || null };
    const { error } = editing
      ? await supabase.from("rw_reasons").update(payload).eq("id", editing.id)
      : await supabase.from("rw_reasons").insert(payload);
    if (error) return toast({ title: "Save failed", description: error.message, variant: "destructive" });
    toast({ title: "Saved" });
    setOpen(false);
    refetch();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this reason?")) return;
    await supabase.from("rw_reasons").delete().eq("id", id);
    refetch();
  };

  const toggleActive = async (r: any) => {
    await supabase.from("rw_reasons").update({ is_active: !r.is_active }).eq("id", r.id);
    refetch();
  };

  return (
    <ERPLayout>
      <div className="w-full max-w-full overflow-x-hidden space-y-4">
        <PageHeader
          title="Rejection & Wastage Reasons"
          description="Master list of reasons for rejections and raw material wastages"
          icon={ListChecks}
          iconColor="bg-amber-500 text-white"
          action={{ label: "Add Reason", onClick: openNew, icon: Plus }}
        />

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reasons.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No reasons yet.</TableCell></TableRow>
                  )}
                  {reasons.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant={r.type === "rejection" ? "destructive" : "secondary"}>{r.type}</Badge>
                      </TableCell>
                      <TableCell>{r.category || "—"}</TableCell>
                      <TableCell><Switch checked={r.is_active} onCheckedChange={() => toggleActive(r)} /></TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => remove(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md max-h-[90vh] w-[95vw]">
            <DialogHeader><DialogTitle>{editing ? "Edit Reason" : "Add Reason"}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                  <SelectItem value="rejection">Rejection</SelectItem>
                  <SelectItem value="wastage">Wastage</SelectItem>
                  <SelectItem value="leakage">Leakage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Category (optional)</Label>
                <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="e.g. Cutting, Defect, Spoilage" />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label>Active</Label>
              </div>
              <Button onClick={save} className="w-full">Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ERPLayout>
  );
}
