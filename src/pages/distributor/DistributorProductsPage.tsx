import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Package, Pencil, Trash2, Search, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { Database } from "@/integrations/supabase/types";

type DistributorProduct = Database["public"]["Tables"]["distributor_products"]["Row"];

const emptyForm = {
  code: "",
  name: "",
  company_product_id: "",
  price: "",
  unit: "",
  is_active: true,
  notes: "",
  image_url: "",
};

export default function DistributorProductsPage() {
  const queryClient = useQueryClient();
  const { getDistributorScope } = useAuth();
  const { isCompany, distributorId } = getDistributorScope();

  const [selectedDistributor, setSelectedDistributor] = useState<string | null>(distributorId);
  const activeDistributorId = isCompany ? selectedDistributor : distributorId;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DistributorProduct | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DistributorProduct | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleImageUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be smaller than 5 MB");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const filePath = `${activeDistributorId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("distributor-products")
        .upload(filePath, file, { upsert: true });
      if (uploadError) throw uploadError;
      const {
        data: { publicUrl },
      } = supabase.storage.from("distributor-products").getPublicUrl(filePath);
      setForm((f) => ({ ...f, image_url: publicUrl }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to upload image");
    } finally {
      setUploading(false);
    }
  };

  const { data: distributors = [] } = useQuery({
    queryKey: ["distributors-active"],
    enabled: isCompany,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributors")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Company product master, for mapping a distributor product to a real SKU.
  const { data: companyProducts = [] } = useQuery({
    queryKey: ["company-products-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["distributor_products", activeDistributorId],
    enabled: !!activeDistributorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("distributor_products")
        .select("*")
        .eq("distributor_id", activeDistributorId as string)
        .order("name");
      if (error) throw error;
      return data as DistributorProduct[];
    },
  });

  const companyName = (id: string | null) => {
    if (!id) return null;
    const p = companyProducts.find((c) => c.id === id);
    return p ? `${p.name} (${p.code})` : "—";
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!activeDistributorId) throw new Error("No distributor selected");
      const payload = {
        distributor_id: activeDistributorId,
        code: form.code.trim() || null,
        name: form.name.trim(),
        company_product_id: form.company_product_id || null,
        price: Number(form.price) || 0,
        unit: form.unit.trim() || null,
        is_active: form.is_active,
        notes: form.notes.trim() || null,
        image_url: form.image_url || null,
      };
      if (editing) {
        const { error } = await supabase
          .from("distributor_products")
          .update(payload)
          .eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("distributor_products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_products", activeDistributorId] });
      toast.success(editing ? "Product updated" : "Product created");
      setDialogOpen(false);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to save product"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("distributor_products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["distributor_products", activeDistributorId] });
      toast.success("Product deleted");
      setDeleteTarget(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to delete product"),
  });

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setDialogOpen(true);
  };

  const openEdit = (p: DistributorProduct) => {
    setEditing(p);
    setForm({
      code: p.code ?? "",
      name: p.name,
      company_product_id: p.company_product_id ?? "",
      price: String(p.price ?? ""),
      unit: p.unit ?? "",
      is_active: p.is_active,
      notes: p.notes ?? "",
      image_url: p.image_url ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!form.name.trim()) {
      toast.error("Product name is required");
      return;
    }
    saveMutation.mutate();
  };

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.code ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const columns = [
    {
      key: "image_url",
      header: "",
      render: (p: DistributorProduct) =>
        p.image_url ? (
          <img
            src={p.image_url}
            alt={p.name}
            className="h-10 w-10 rounded-md border object-cover"
          />
        ) : (
          <div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-muted-foreground">
            <Package className="h-4 w-4" />
          </div>
        ),
    },
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "company_product_id",
      header: "Mapped Company SKU",
      render: (p: DistributorProduct) =>
        p.company_product_id ? (
          <span className="text-sm">{companyName(p.company_product_id)}</span>
        ) : (
          <Badge variant="outline" className="text-amber-600 border-amber-300">Unmapped</Badge>
        ),
    },
    {
      key: "price",
      header: "Price",
      render: (p: DistributorProduct) => Number(p.price ?? 0).toLocaleString(),
    },
    { key: "unit", header: "Unit" },
    {
      key: "is_active",
      header: "Status",
      render: (p: DistributorProduct) => (
        <StatusBadge status={p.is_active ? "approved" : "rejected"} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (p: DistributorProduct) => (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => openEdit(p)}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteTarget(p)}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Products & Pricing"
        description="Your distributor's own product list and selling prices. Map each to a company SKU for bulk dispatch."
        icon={Package}
        action={activeDistributorId ? { label: "New Product", onClick: openNew } : undefined}
      />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          {isCompany && (
            <div className="w-full sm:w-72">
              <Select value={selectedDistributor ?? ""} onValueChange={(v) => setSelectedDistributor(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a distributor..." />
                </SelectTrigger>
                <SelectContent>
                  {distributors.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name} ({d.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {!activeDistributorId ? (
          <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground">
            {isCompany
              ? "Select a distributor to view their products."
              : "Your account is not linked to a distributor. Contact your administrator."}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            emptyMessage={isLoading ? "Loading..." : "No products yet"}
          />
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Product" : "New Product"}</DialogTitle>
            <DialogDescription>Product details and selling price</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-2">
            <div className="space-y-2">
              <Label>Product Picture</Label>
              <div className="flex items-center gap-4">
                <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg border bg-muted">
                  {form.image_url ? (
                    <>
                      <img src={form.image_url} alt="Product" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, image_url: "" })}
                        className="absolute right-1 top-1 rounded-full bg-background/80 p-0.5 text-destructive shadow"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <Package className="h-7 w-7" />
                    </div>
                  )}
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="product_image"
                    className="inline-flex cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm font-medium hover:bg-accent"
                  >
                    <ImagePlus className="h-4 w-4" />
                    {uploading ? "Uploading…" : form.image_url ? "Change picture" : "Upload picture"}
                  </Label>
                  <Input
                    id="product_image"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploading || !activeDistributorId}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImageUpload(file);
                      e.target.value = "";
                    }}
                  />
                  <p className="text-xs text-muted-foreground">Shown on the order menu. PNG/JPG, up to 5 MB.</p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="code">Code</Label>
                <Input id="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="Optional" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Mapped Company SKU</Label>
              <SearchableSelect
                value={form.company_product_id}
                onValueChange={(v) => setForm({ ...form, company_product_id: v })}
                options={companyProducts.map((c) => ({ value: c.id, label: c.name, secondary: c.code }))}
                placeholder="Map to a company product (for bulk dispatch)…"
              />
              <p className="text-xs text-muted-foreground">
                Optional now, but required for the company requirement to aggregate by SKU.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price">Selling Price</Label>
                <Input id="price" type="number" inputMode="decimal" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unit</Label>
                <Input id="unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. dozen, ctn" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="is_active" checked={form.is_active} onCheckedChange={(c) => setForm({ ...form, is_active: c })} />
              <Label htmlFor="is_active">Active</Label>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {editing ? "Save Changes" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{deleteTarget?.name}</strong>? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
