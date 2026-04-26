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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Package, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface OnlineItem {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export default function OnlineItemMasterPage() {
  const [items, setItems] = useState<OnlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", is_active: true });

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    const { data } = await supabase.from("online_items").select("*").order("name");
    setItems((data as OnlineItem[]) || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", code: "", description: "", is_active: true });
    setIsDialogOpen(true);
  };

  const openEdit = (item: OnlineItem) => {
    setEditingId(item.id);
    setForm({ name: item.name, code: item.code || "", description: item.description || "", is_active: item.is_active });
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase() || null,
      description: form.description.trim() || null,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
    };
    if (editingId) {
      const { error } = await supabase.from("online_items").update(payload).eq("id", editingId);
      if (error) { toast.error(error.message); return; }
      toast.success("Item updated");
    } else {
      const { error } = await supabase.from("online_items").insert(payload as any);
      if (error) { toast.error(error.message); return; }
      toast.success("Item created");
    }
    setIsDialogOpen(false);
    fetchItems();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("online_items").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Item deleted");
    fetchItems();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader title="Item Master" description="Manage items sold through online channels" icon={Package} iconColor="bg-emerald-600 text-white" action={{ label: "Add Item", onClick: openCreate, icon: Plus }} />

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No items found</TableCell></TableRow>
                ) : items.map(item => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.code || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.description || "-"}</TableCell>
                    <TableCell><Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => openEdit(item)}><Pencil className="h-3 w-3" /></Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button size="sm" variant="outline" className="text-destructive"><Trash2 className="h-3 w-3" /></Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Item</AlertDialogTitle>
                              <AlertDialogDescription>Are you sure you want to delete "{item.name}"? This cannot be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => handleDelete(item.id)}>Delete</AlertDialogAction>
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
          <DialogHeader><DialogTitle>{editingId ? "Edit Item" : "Add Item"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Item Name *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Cricket Bat" />
            </div>
            <div>
              <Label>Code</Label>
              <Input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} placeholder="e.g. CB001" className="uppercase" />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
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
