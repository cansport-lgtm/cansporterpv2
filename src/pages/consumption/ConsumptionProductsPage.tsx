import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface ConsumptionProduct {
  id: string;
  code: string;
  name: string;
  unit: string | null;
  description: string | null;
  is_active: boolean | null;
}

interface LinkedMaterial {
  id: string;
  source_product_id: string | null;
  cost_value: number | null;
  is_active: boolean | null;
}

const UNITS = ["kg", "g", "ltr", "ml", "pcs", "mtr", "rolls", "sheets", "dozen", "box"];

// Category assigned to the raw-material row of an intermediate product, so
// compounds group together on the stock-closing sheet.
const INTERMEDIATE_CATEGORY = "Intermediate";

export default function ConsumptionProductsPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<ConsumptionProduct | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    unit: "pcs",
    description: "",
    is_active: true,
    is_intermediate: false,
    cost_value: "",
  });

  const { data: products, isLoading } = useQuery({
    queryKey: ["consumption-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_products")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as ConsumptionProduct[];
    },
  });

  // Raw-material rows linked to a product = intermediates (e.g. compounds).
  const { data: linkedMaterials } = useQuery({
    queryKey: ["consumption-intermediate-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, source_product_id, cost_value, is_active")
        .not("source_product_id", "is", null);
      if (error) throw error;
      return data as LinkedMaterial[];
    },
  });

  const linkedMaterialFor = (productId: string) =>
    linkedMaterials?.find((rm) => rm.source_product_id === productId);

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      const productPayload = {
        code: data.code,
        name: data.name,
        unit: data.unit,
        description: data.description,
        is_active: data.is_active,
      };

      let productId = data.id;
      if (productId) {
        const { error } = await supabase
          .from("consumption_products")
          .update(productPayload)
          .eq("id", productId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("consumption_products")
          .insert(productPayload)
          .select("id")
          .single();
        if (error) throw error;
        productId = inserted.id;
      }

      // Intermediate products also live in the raw-materials master so they
      // appear on the stock-closing sheet and can be used in other BOMs.
      // Receipts for that row auto-fill from this product's production entries.
      const linked = linkedMaterialFor(productId);
      if (data.is_intermediate) {
        const rmPayload = {
          code: data.code,
          name: data.name,
          unit: data.unit,
          category: INTERMEDIATE_CATEGORY,
          cost_value: parseFloat(data.cost_value) || 0,
          is_active: data.is_active,
          source_product_id: productId,
        };
        if (linked) {
          const { error } = await supabase
            .from("consumption_raw_materials")
            .update(rmPayload)
            .eq("id", linked.id);
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from("consumption_raw_materials")
            .insert(rmPayload);
          if (error) throw error;
        }
      } else if (linked && linked.is_active) {
        // Deactivate (not delete) so closing history stays intact.
        const { error } = await supabase
          .from("consumption_raw_materials")
          .update({ is_active: false })
          .eq("id", linked.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-products"] });
      queryClient.invalidateQueries({ queryKey: ["consumption-intermediate-materials"] });
      queryClient.invalidateQueries({ queryKey: ["consumption-raw-materials-active"] });
      toast.success(editingProduct ? "Product updated" : "Product added");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save product");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("consumption_products")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-products"] });
      toast.success("Product deleted");
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete product");
    },
  });

  const handleOpenDialog = (product?: ConsumptionProduct) => {
    if (product) {
      const linked = linkedMaterialFor(product.id);
      setEditingProduct(product);
      setFormData({
        code: product.code,
        name: product.name,
        unit: product.unit || "pcs",
        description: product.description || "",
        is_active: product.is_active ?? true,
        is_intermediate: !!linked?.is_active,
        cost_value: linked?.cost_value ? String(linked.cost_value) : "",
      });
    } else {
      setEditingProduct(null);
      setFormData({
        code: "",
        name: "",
        unit: "pcs",
        description: "",
        is_active: true,
        is_intermediate: false,
        cost_value: "",
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...formData,
      id: editingProduct?.id,
    });
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Products Master</h1>
            <p className="page-description">Manage products for consumption tracking</p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Product
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">Loading...</TableCell>
                  </TableRow>
                ) : products?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No products found. Add your first product.
                    </TableCell>
                  </TableRow>
                ) : (
                  products?.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-mono">{product.code}</TableCell>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell>{product.unit || "-"}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{product.description || "-"}</TableCell>
                      <TableCell>
                        {linkedMaterialFor(product.id)?.is_active ? (
                          <Badge variant="outline">Intermediate</Badge>
                        ) : (
                          <span className="text-muted-foreground">Product</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={product.is_active ? "default" : "secondary"}>
                          {product.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(product)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(product.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingProduct ? "Edit Product" : "Add Product"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                    placeholder="PRD001"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Product name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <div className="space-y-2 rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={formData.is_intermediate}
                    onCheckedChange={(v) => setFormData({ ...formData, is_intermediate: v })}
                  />
                  <Label>Intermediate (compound)</Label>
                </div>
                <p className="text-xs text-muted-foreground">
                  An intermediate is produced here (e.g. H72 Compound from Smoke Rubber) and then
                  consumed to make other products. It gets its own row on the Stock Closing sheet,
                  its receipts auto-fill from its Production Entries, and it can be added as a
                  material in other products' BOMs.
                </p>
                {formData.is_intermediate && (
                  <div className="space-y-2">
                    <Label>Cost per {formData.unit} (for loss valuation)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData.cost_value}
                      onChange={(e) => setFormData({ ...formData, cost_value: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                />
                <Label>Active</Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>Cancel</Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Product?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this product and all related BOM and production entries.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
