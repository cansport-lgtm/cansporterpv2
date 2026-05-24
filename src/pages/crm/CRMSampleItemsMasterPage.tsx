import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

interface Product { id: string; name: string; brand: string | null; }
interface Variant { id: string; product_id: string; variant_name: string; sku: string | null; }
interface SampleItem {
  id: string;
  product_id: string;
  variant_id: string | null;
  sku: string | null;
  unit: string;
  reorder_level: number;
  is_active: boolean;
  notes: string | null;
}

const emptyForm = {
  id: "",
  product_id: "",
  variant_id: "none",
  sku: "",
  unit: "pcs",
  reorder_level: 0,
  is_active: true,
  notes: "",
};

export default function CRMSampleItemsMasterPage() {
  const [items, setItems] = useState<SampleItem[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [saving, setSaving] = useState(false);

  const prodMap = useMemo(() => Object.fromEntries(products.map(p => [p.id, p])), [products]);
  const varMap = useMemo(() => Object.fromEntries(variants.map(v => [v.id, v])), [variants]);

  const load = async () => {
    setLoading(true);
    const [it, pr, vr] = await Promise.all([
      supabase.from("crm_sample_items").select("*").order("created_at", { ascending: false }),
      supabase.from("crm_products").select("id,name,brand").order("name"),
      supabase.from("crm_product_variants").select("id,product_id,variant_name,sku").order("variant_name"),
    ]);
    if (it.error) toast.error(it.error.message);
    setItems((it.data as any) || []);
    setProducts((pr.data as any) || []);
    setVariants((vr.data as any) || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => { setForm(emptyForm); setOpen(true); };
  const openEdit = (it: SampleItem) => {
    setForm({
      id: it.id,
      product_id: it.product_id,
      variant_id: it.variant_id || "none",
      sku: it.sku || "",
      unit: it.unit || "pcs",
      reorder_level: Number(it.reorder_level || 0),
      is_active: it.is_active,
      notes: it.notes || "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.product_id) { toast.error("Pick a product"); return; }
    setSaving(true);
    const payload = {
      product_id: form.product_id,
      variant_id: form.variant_id === "none" ? null : form.variant_id,
      sku: form.sku || null,
      unit: form.unit || "pcs",
      reorder_level: Number(form.reorder_level) || 0,
      is_active: form.is_active,
      notes: form.notes || null,
    };
    const res = form.id
      ? await supabase.from("crm_sample_items").update(payload).eq("id", form.id)
      : await supabase.from("crm_sample_items").insert(payload);
    setSaving(false);
    if (res.error) { toast.error(res.error.message); return; }
    toast.success("Saved");
    setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this sample item?")) return;
    const { error } = await supabase.from("crm_sample_items").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    load();
  };

  const productVariants = (pid: string) => variants.filter(v => v.product_id === pid);

  const filtered = items.filter(i => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      (prodMap[i.product_id]?.name || "").toLowerCase().includes(q) ||
      (i.sku || "").toLowerCase().includes(q) ||
      (i.variant_id ? varMap[i.variant_id]?.variant_name || "" : "").toLowerCase().includes(q)
    );
  });

  return (
    <ERPLayout>
      <PageHeader title="Sample Items Master" description="CRM products tracked as samples" />
      <div className="flex items-center justify-between gap-3 mb-3">
        <Input placeholder="Search product / SKU / variant..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load}><RefreshCw className="h-4 w-4 mr-1" />Refresh</Button>
          <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />Add Sample Item</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Variant</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Reorder Level</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center p-6">Loading...</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center p-6 text-muted-foreground">No sample items yet</TableCell></TableRow>
              ) : filtered.map(i => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{prodMap[i.product_id]?.name || "—"}<div className="text-xs text-muted-foreground">{prodMap[i.product_id]?.brand}</div></TableCell>
                  <TableCell>{i.variant_id ? varMap[i.variant_id]?.variant_name || "—" : <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>{i.sku || "—"}</TableCell>
                  <TableCell>{i.unit}</TableCell>
                  <TableCell>{i.reorder_level}</TableCell>
                  <TableCell>
                    {i.is_active ? <Badge className="bg-green-100 text-green-800 border-green-300">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(i)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(i.id)}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg w-[95vw]">
          <DialogHeader><DialogTitle>{form.id ? "Edit" : "Add"} Sample Item</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Product *</Label>
              <Select value={form.product_id} onValueChange={(v) => setForm({ ...form, product_id: v, variant_id: "none" })}>
                <SelectTrigger><SelectValue placeholder="Pick a CRM product" /></SelectTrigger>
                <SelectContent>
                  {products.map(p => <SelectItem key={p.id} value={p.id}>{p.name}{p.brand ? ` — ${p.brand}` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-2">
              <Label>Variant (optional)</Label>
              <Select value={form.variant_id} onValueChange={(v) => setForm({ ...form, variant_id: v })} disabled={!form.product_id}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {productVariants(form.product_id).map(v => <SelectItem key={v.id} value={v.id}>{v.variant_name}{v.sku ? ` (${v.sku})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>SKU</Label>
              <Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </div>
            <div>
              <Label>Unit</Label>
              <Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
            <div>
              <Label>Reorder Level</Label>
              <Input type="number" value={form.reorder_level} onChange={(e) => setForm({ ...form, reorder_level: Number(e.target.value) })} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
              <span className="text-sm">Active</span>
            </div>
            <div className="col-span-2">
              <Label>Notes</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
