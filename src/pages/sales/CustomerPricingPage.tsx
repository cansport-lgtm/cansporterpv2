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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Tag } from "lucide-react";
import { format } from "date-fns";

const sb = supabase as any;

interface FormState {
  id?: string;
  customer_id: string;
  product_id: string;
  price_per_dozen: number;
  min_quantity_dozens: number;
  effective_from: string;
  effective_to: string; // empty = no end date
  is_active: boolean;
}

const blankForm = (): FormState => ({
  customer_id: "",
  product_id: "",
  price_per_dozen: 0,
  min_quantity_dozens: 1,
  effective_from: format(new Date(), "yyyy-MM-dd"),
  effective_to: "",
  is_active: true,
});

export default function CustomerPricingPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<FormState>(blankForm());
  const [customerFilter, setCustomerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [activeFilter, setActiveFilter] = useState<"all" | "active" | "inactive">("active");

  const { data: customers } = useQuery({
    queryKey: ["pricing-customers"],
    queryFn: async () => {
      const { data, error } = await sb.from("customers").select("id, code, name").order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["pricing-products"],
    queryFn: async () => {
      const { data, error } = await sb.from("products").select("id, code, name, is_active").eq("is_active", true).order("name");
      if (error) throw error;
      return data || [];
    },
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["customer-pricing", customerFilter, productFilter, activeFilter],
    queryFn: async () => {
      let q = sb
        .from("customer_pricing")
        .select(`
          id, customer_id, product_id, price_per_dozen, min_quantity_dozens,
          effective_from, effective_to, is_active, created_at, updated_at,
          customer:customers(name, code), product:products(name, code)
        `)
        .order("updated_at", { ascending: false });
      if (customerFilter !== "all") q = q.eq("customer_id", customerFilter);
      if (productFilter !== "all") q = q.eq("product_id", productFilter);
      if (activeFilter === "active") q = q.eq("is_active", true);
      else if (activeFilter === "inactive") q = q.eq("is_active", false);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: FormState) => {
      if (!data.customer_id) throw new Error("Pick a customer");
      if (!data.product_id) throw new Error("Pick a product");
      if (!(data.price_per_dozen > 0)) throw new Error("Price must be greater than zero");
      if (!data.effective_from) throw new Error("Effective from is required");
      if (data.effective_to && data.effective_to < data.effective_from) {
        throw new Error("Effective to cannot be before Effective from");
      }

      const payload: Record<string, any> = {
        customer_id: data.customer_id,
        product_id: data.product_id,
        price_per_dozen: data.price_per_dozen,
        min_quantity_dozens: data.min_quantity_dozens || 1,
        effective_from: data.effective_from,
        effective_to: data.effective_to || null,
        is_active: data.is_active,
      };

      if (data.id) {
        const { error } = await sb.from("customer_pricing").update(payload).eq("id", data.id);
        if (error) throw error;
        return { mode: "updated" };
      } else {
        const { error } = await sb.from("customer_pricing").insert(payload);
        if (error) throw error;
        return { mode: "created" };
      }
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["customer-pricing"] });
      toast({ title: `Price ${r.mode}` });
      setDialogOpen(false);
      setForm(blankForm());
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await sb.from("customer_pricing").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-pricing"] });
      toast({ title: "Price removed" });
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, next }: { id: string; next: boolean }) => {
      const { error } = await sb.from("customer_pricing").update({ is_active: next }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["customer-pricing"] }),
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const openNew = () => {
    setForm(blankForm());
    setDialogOpen(true);
  };
  const openEdit = (row: any) => {
    setForm({
      id: row.id,
      customer_id: row.customer_id,
      product_id: row.product_id,
      price_per_dozen: Number(row.price_per_dozen),
      min_quantity_dozens: Number(row.min_quantity_dozens || 1),
      effective_from: row.effective_from,
      effective_to: row.effective_to || "",
      is_active: !!row.is_active,
    });
    setDialogOpen(true);
  };

  const stats = {
    count: rows?.length || 0,
    active: (rows || []).filter((r: any) => r.is_active).length,
    customers: new Set((rows || []).map((r: any) => r.customer_id)).size,
    products: new Set((rows || []).map((r: any) => r.product_id)).size,
  };

  return (
    <ERPLayout>
      <PageHeader title="Customer Pricing" description="Per-customer, per-product price list used by Quotations and Sales Orders.">
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" />New Price</Button>
      </PageHeader>

      <div className="grid grid-cols-4 gap-3 mb-4">
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Total Prices</div><div className="text-lg font-semibold">{stats.count}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Active</div><div className="text-lg font-semibold text-green-600">{stats.active}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Customers Covered</div><div className="text-lg font-semibold">{stats.customers}</div></CardContent></Card>
        <Card><CardContent className="p-3"><div className="text-xs text-muted-foreground">Products Covered</div><div className="text-lg font-semibold">{stats.products}</div></CardContent></Card>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <SearchableSelect
          value={customerFilter}
          onValueChange={setCustomerFilter}
          placeholder="Customer"
          triggerClassName="w-[220px]"
          options={[
            { value: "all", label: "All customers" },
            ...(customers || []).map((c: any) => ({ value: c.id, label: c.name, search: c.code })),
          ]}
        />
        <SearchableSelect
          value={productFilter}
          onValueChange={setProductFilter}
          placeholder="Product"
          triggerClassName="w-[220px]"
          options={[
            { value: "all", label: "All products" },
            ...(products || []).map((p: any) => ({ value: p.id, label: p.name, secondary: `(${p.code})`, search: p.code })),
          ]}
        />
        <Select value={activeFilter} onValueChange={(v: any) => setActiveFilter(v)}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active only</SelectItem>
            <SelectItem value="inactive">Inactive only</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border rounded-lg">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Price / Dz</TableHead>
              <TableHead className="text-right">Min Qty</TableHead>
              <TableHead>Effective</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Loading...</TableCell></TableRow>}
            {!isLoading && !rows?.length && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">No prices yet. Click "New Price" to add one.</TableCell></TableRow>}
            {rows?.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{r.customer?.name || "—"} <span className="text-muted-foreground">({r.customer?.code || "—"})</span></TableCell>
                <TableCell className="text-xs"><span className="font-mono mr-1">{r.product?.code || "—"}</span>{r.product?.name || ""}</TableCell>
                <TableCell className="text-right text-xs font-medium">Rs. {Number(r.price_per_dozen).toLocaleString()}</TableCell>
                <TableCell className="text-right text-xs">{r.min_quantity_dozens}</TableCell>
                <TableCell className="text-xs">
                  {format(new Date(r.effective_from), "dd MMM yyyy")}
                  {r.effective_to ? ` → ${format(new Date(r.effective_to), "dd MMM yyyy")}` : <span className="text-muted-foreground"> → onwards</span>}
                </TableCell>
                <TableCell>
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: r.id, next: !r.is_active })}
                    title={r.is_active ? "Click to deactivate" : "Click to activate"}
                  >
                    <Badge variant="outline" className={r.is_active ? "bg-green-100 text-green-800 border-green-200" : "bg-gray-100 text-gray-800 border-gray-200"}>
                      {r.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </button>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-3 w-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                      if (confirm(`Delete this price entry?\n${r.customer?.name} · ${r.product?.name} · Rs. ${Number(r.price_per_dozen).toLocaleString()}`)) {
                        deleteMutation.mutate(r.id);
                      }
                    }} title="Delete"><Trash2 className="h-3 w-3 text-destructive" /></Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* ===== Create / Edit Dialog ===== */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" />{form.id ? "Edit Price" : "New Customer Price"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Customer *</Label>
                <SearchableSelect
                  value={form.customer_id}
                  onValueChange={(v) => setForm({ ...form, customer_id: v })}
                  placeholder="Pick customer"
                  options={(customers || []).map((c: any) => ({
                    value: c.id, label: c.name, secondary: `(${c.code})`, search: c.code,
                  }))}
                />
              </div>
              <div>
                <Label>Product *</Label>
                <SearchableSelect
                  value={form.product_id}
                  onValueChange={(v) => setForm({ ...form, product_id: v })}
                  placeholder="Pick product"
                  options={(products || []).map((p: any) => ({
                    value: p.id, label: p.name, secondary: `(${p.code})`, search: p.code,
                  }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Price per Dozen (Rs.) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={form.price_per_dozen || ""}
                  onChange={(e) => setForm({ ...form, price_per_dozen: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div>
                <Label>Min Quantity (Dz)</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.min_quantity_dozens}
                  onChange={(e) => setForm({ ...form, min_quantity_dozens: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Effective From *</Label>
                <Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} />
              </div>
              <div>
                <Label>Effective To</Label>
                <Input type="date" value={form.effective_to} onChange={(e) => setForm({ ...form, effective_to: e.target.value })} placeholder="leave blank = ongoing" />
                <p className="text-xs text-muted-foreground mt-1">Leave blank for an open-ended price.</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} />
              <Label>Active</Label>
              <span className="text-xs text-muted-foreground">— inactive prices are ignored by Quotations & Orders.</span>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate(form)}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
