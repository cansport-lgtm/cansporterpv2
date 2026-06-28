import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Store, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Platform {
  id: string;
  name: string;
  code: string;
  commission_pct: number | null;
  is_active: boolean;
  created_at: string;
}

export default function OnlinePlatformMasterPage() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", commission_pct: "", is_active: true });

  useEffect(() => { fetchPlatforms(); }, []);

  const fetchPlatforms = async () => {
    setLoading(true);
    const { data } = await supabase.from("online_platforms").select("*").order("name");
    setPlatforms((data as Platform[]) || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", code: "", commission_pct: "", is_active: true });
    setIsDialogOpen(true);
  };

  const openEdit = (p: Platform) => {
    setEditingId(p.id);
    setForm({ name: p.name, code: p.code, commission_pct: p.commission_pct != null ? String(p.commission_pct) : "", is_active: p.is_active });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast.error("Name and code are required");
      return;
    }
    if (editingId) {
      const { error } = await supabase.from("online_platforms").update({ name: form.name.trim(), code: form.code.trim().toUpperCase(), commission_pct: form.commission_pct.trim() === "" ? 0 : Number(form.commission_pct), is_active: form.is_active, updated_at: new Date().toISOString() }).eq("id", editingId);
      if (error) { toast.error(error.message); return; }
      toast.success("Platform updated");
    } else {
      const { error } = await supabase.from("online_platforms").insert({ name: form.name.trim(), code: form.code.trim().toUpperCase(), commission_pct: form.commission_pct.trim() === "" ? 0 : Number(form.commission_pct), is_active: form.is_active });
      if (error) { toast.error(error.message); return; }
      toast.success("Platform created");
    }
    setIsDialogOpen(false);
    fetchPlatforms();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("online_platforms").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Platform deleted");
    fetchPlatforms();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Platform Master" description="Manage online sales platforms" icon={Store} iconColor="bg-emerald-600 text-white" action={{ label: "Add Platform", onClick: openCreate, icon: Plus }} />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead className="text-right">Commission %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : platforms.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No platforms found</TableCell></TableRow>
                ) : platforms.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>{p.code}</TableCell>
                    <TableCell className="text-right">{p.commission_pct != null ? `${Number(p.commission_pct)}%` : "-"}</TableCell>
                    <TableCell><Badge variant={p.is_active ? "default" : "secondary"}>{p.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(p)}><Pencil className="h-3 w-3" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-destructive"><Trash2 className="h-3 w-3" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Platform</AlertDialogTitle>
                              <AlertDialogDescription>Are you sure you want to delete "{p.name}"? This cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(p.id)}>Delete</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingId ? "Edit Platform" : "Add Platform"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Platform Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Amazon" />
            </div>
            <div>
              <Label>Code *</Label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. AMZ" className="uppercase" />
            </div>
            <div>
              <Label>Commission % (deducted in P&L)</Label>
              <Input type="number" min="0" max="100" step="0.01" value={form.commission_pct} onChange={e => setForm(p => ({ ...p, commission_pct: e.target.value }))} placeholder="e.g. 5" />
            </div>
            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form.is_active} onCheckedChange={checked => setForm(p => ({ ...p, is_active: checked }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>{editingId ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
