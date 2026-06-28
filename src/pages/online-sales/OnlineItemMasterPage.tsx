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
  price: number | null;
  cost_price: number | null;
  reorder_level: number | null;
  is_active: boolean;
  created_at: string;
}

export default function OnlineItemMasterPage() {
  const [items, setItems] = useState<OnlineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", code: "", description: "", price: "", cost_price: "", reorder_level: "", is_active: true });

  useEffect(() => { fetchItems(); }, []);

  const fetchItems = async () => {
    setLoading(true);
    const { data } = await supabase.from("online_items").select("*").order("name");
    setItems((data as OnlineItem[]) || []);
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm({ name: "", code: "", description: "", price: "", cost_price: "", reorder_level: "", is_active: true });
    setIsDialogOpen(true);
  };

  const openEdit = (item: OnlineItem) => {
    setEditingId(item.id);
    setForm({ name: item.name, code: item.code || "", description: item.description || "", price: item.price != null ? String(item.price) : "", cost_price: item.cost_price != null ? String(item.cost_price) : "", reorder_level: item.reorder_level != null ? String(item.reorder_level) : "", is_active: item.is_active });
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
      price: form.price.trim() === "" ? 0 : Number(form.price),
      cost_price: form.cost_price.trim() === "" ? 0 : Number(form.cost_price),
      reorder_level: form.reorder_level.trim() === "" ? 0 : Number(form.reorder_level),
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
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
                ) : items.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No items found</TableCell></TableRow>
                ) : items.map(item => {
                  const price = Number(item.price || 0);
                  const cost = Number(item.cost_price || 0);
                  const marginPct = price > 0 ? ((price - cost) / price) * 100 : null;
                  return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.code || "-"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.description || "-"}</TableCell>
                    <TableCell className="text-right">{item.cost_price != null ? cost.toLocaleString() : "-"}</TableCell>
                    <TableCell className="text-right">{item.price != null ? price.toLocaleString() : "-"}</TableCell>
                    <TableCell className="text-right">
                      {marginPct != null ? (
                        <span className={marginPct < 0 ? "text-destructive" : marginPct < 15 ? "text-amber-600" : "text-emerald-600"}>
                          {marginPct.toFixed(1)}%
                        </span>
                      ) : "-"}
                    </TableCell>
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
                  );
                })}
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
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Cost Price (Rs.)</Label>
                <Input type="number" min="0" step="0.01" value={form.cost_price} onChange={e => setForm(p => ({ ...p, cost_price: e.target.value }))} placeholder="0.00" />
              </div>
              <div>
                <Label>Selling Price (Rs.)</Label>
                <Input type="number" min="0" step="0.01" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="0.00" />
              </div>
            </div>
            <div>
              <Label>Reorder Level <span className="text-muted-foreground font-normal">(low-stock alert when on-hand ≤ this)</span></Label>
              <Input type="number" min="0" step="1" value={form.reorder_level} onChange={e => setForm(p => ({ ...p, reorder_level: e.target.value }))} placeholder="0" />
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
