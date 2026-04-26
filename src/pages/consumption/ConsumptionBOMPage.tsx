import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface BOMEntry {
  id: string;
  product_id: string;
  raw_material_id: string;
  standard_quantity: number;
  unit: string;
  is_active: boolean;
  remarks: string | null;
  product?: { code: string; name: string };
  raw_material?: { code: string; name: string; unit: string };
}

interface ConsumptionProduct {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit: string;
  is_active: boolean;
}

export default function ConsumptionBOMPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [editingBOM, setEditingBOM] = useState<BOMEntry | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    product_id: "",
    raw_material_id: "",
    standard_quantity: "",
    unit: "kg",
    remarks: "",
    is_active: true,
  });

  const [productFormData, setProductFormData] = useState({
    code: "",
    name: "",
    description: "",
    unit: "pcs",
  });

  const { data: bomEntries, isLoading } = useQuery({
    queryKey: ["consumption-bom"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_bom")
        .select(`
          *,
          product:consumption_products(code, name),
          raw_material:consumption_raw_materials(code, name, unit)
        `)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as BOMEntry[];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["consumption-products-for-bom"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_products")
        .select("id, code, name")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const { data: rawMaterials } = useQuery({
    queryKey: ["raw-materials-for-bom"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const payload = {
        product_id: data.product_id,
        raw_material_id: data.raw_material_id,
        standard_quantity: parseFloat(data.standard_quantity),
        unit: data.unit,
        remarks: data.remarks || null,
        is_active: data.is_active,
      };
      if (data.id) {
        const { error } = await supabase
          .from("consumption_bom")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("consumption_bom")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-bom"] });
      toast.success(editingBOM ? "BOM updated" : "BOM added");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save BOM");
    },
  });

  const saveProductMutation = useMutation({
    mutationFn: async (data: typeof productFormData) => {
      const { error } = await supabase
        .from("consumption_products")
        .insert({
          code: data.code,
          name: data.name,
          is_active: true,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-products-for-bom"] });
      toast.success("Product added successfully");
      setIsProductDialogOpen(false);
      setProductFormData({ code: "", name: "", description: "", unit: "pcs" });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add product");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("consumption_bom")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-bom"] });
      toast.success("BOM entry deleted");
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete");
    },
  });

  const handleOpenDialog = (bom?: BOMEntry) => {
    if (bom) {
      setEditingBOM(bom);
      setFormData({
        product_id: bom.product_id,
        raw_material_id: bom.raw_material_id,
        standard_quantity: bom.standard_quantity.toString(),
        unit: bom.unit,
        remarks: bom.remarks || "",
        is_active: bom.is_active,
      });
    } else {
      setEditingBOM(null);
      setFormData({
        product_id: "",
        raw_material_id: "",
        standard_quantity: "",
        unit: "kg",
        remarks: "",
        is_active: true,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingBOM(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...formData,
      id: editingBOM?.id,
    });
  };

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productFormData.code || !productFormData.name) {
      toast.error("Code and Name are required");
      return;
    }
    saveProductMutation.mutate(productFormData);
  };

  // Update unit when raw material is selected
  const handleMaterialChange = (materialId: string) => {
    const material = rawMaterials?.find((m) => m.id === materialId);
    setFormData({
      ...formData,
      raw_material_id: materialId,
      unit: material?.unit || "kg",
    });
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Consumption BOM</h1>
            <p className="page-description">Define standard material consumption per product unit</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsProductDialogOpen(true)}>
              <Package className="mr-2 h-4 w-4" />
              Add Product
            </Button>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="mr-2 h-4 w-4" />
              Add BOM Entry
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Raw Material</TableHead>
                  <TableHead className="text-right">Std Qty per Unit</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">Loading...</TableCell>
                  </TableRow>
                ) : bomEntries?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground">
                      No BOM entries found. Add your first entry.
                    </TableCell>
                  </TableRow>
                ) : (
                  bomEntries?.map((bom) => (
                    <TableRow key={bom.id}>
                      <TableCell className="font-medium">
                        {bom.product?.code} - {bom.product?.name}
                      </TableCell>
                      <TableCell>
                        {bom.raw_material?.code} - {bom.raw_material?.name}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {Number(bom.standard_quantity).toFixed(4)}
                      </TableCell>
                      <TableCell>{bom.unit}</TableCell>
                      <TableCell>
                        <Badge variant={bom.is_active ? "default" : "secondary"}>
                          {bom.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(bom)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(bom.id)}>
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

        {/* BOM Entry Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingBOM ? "Edit BOM Entry" : "Add BOM Entry"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Product *</Label>
                <Select
                  value={formData.product_id}
                  onValueChange={(v) => setFormData({ ...formData, product_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select product" />
                  </SelectTrigger>
                  <SelectContent>
                    {products?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.code} - {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(!products || products.length === 0) && (
                  <p className="text-xs text-muted-foreground">
                    No products found. Click "Add Product" to create one.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label>Raw Material *</Label>
                <Select
                  value={formData.raw_material_id}
                  onValueChange={handleMaterialChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select raw material" />
                  </SelectTrigger>
                  <SelectContent>
                    {rawMaterials?.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.code} - {m.name} ({m.unit})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Standard Quantity per Unit *</Label>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={formData.standard_quantity}
                    onChange={(e) => setFormData({ ...formData, standard_quantity: e.target.value })}
                    placeholder="0.0000"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Input value={formData.unit} disabled />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Remarks</Label>
                <Textarea
                  value={formData.remarks}
                  onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                  placeholder="Optional notes"
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

        {/* Add Product Dialog */}
        <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Product</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleProductSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code *</Label>
                  <Input
                    value={productFormData.code}
                    onChange={(e) => setProductFormData({ ...productFormData, code: e.target.value.toUpperCase() })}
                    placeholder="PROD001"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select
                    value={productFormData.unit}
                    onValueChange={(v) => setProductFormData({ ...productFormData, unit: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pcs">Pcs</SelectItem>
                      <SelectItem value="kg">Kg</SelectItem>
                      <SelectItem value="mtr">Mtr</SelectItem>
                      <SelectItem value="dozen">Dozen</SelectItem>
                      <SelectItem value="pair">Pair</SelectItem>
                      <SelectItem value="bags">Bags</SelectItem>
                      <SelectItem value="sheet">Sheet</SelectItem>
                      <SelectItem value="litre">Litre</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={productFormData.name}
                  onChange={(e) => setProductFormData({ ...productFormData, name: e.target.value })}
                  placeholder="Product name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={productFormData.description}
                  onChange={(e) => setProductFormData({ ...productFormData, description: e.target.value })}
                  placeholder="Optional description"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsProductDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveProductMutation.isPending}>
                  {saveProductMutation.isPending ? "Adding..." : "Add Product"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete BOM Entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this BOM entry.
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
