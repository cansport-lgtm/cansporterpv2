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

const UNITS = ["kg", "g", "ltr", "ml", "pcs", "mtr", "rolls", "sheets", "dozen", "box"];

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

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("consumption_products")
          .update(data)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("consumption_products")
          .insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-products"] });
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
      setEditingProduct(product);
      setFormData({
        code: product.code,
        name: product.name,
        unit: product.unit || "pcs",
        description: product.description || "",
        is_active: product.is_active ?? true,
      });
    } else {
      setEditingProduct(null);
      setFormData({
        code: "",
        name: "",
        unit: "pcs",
        description: "",
        is_active: true,
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
                  <TableHead>Description</TableHead>
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
