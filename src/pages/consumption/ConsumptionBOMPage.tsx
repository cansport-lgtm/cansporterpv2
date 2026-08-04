import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2, Package, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
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

// One editable row of the recipe editor. Rows loaded from the DB carry their
// id; rows without an id are new lines inserted on save.
interface RecipeLine {
  id?: string;
  raw_material_id: string;
  standard_quantity: string;
  unit: string;
  remarks: string;
  is_active: boolean;
}

const emptyLine = (): RecipeLine => ({
  raw_material_id: "",
  standard_quantity: "",
  unit: "kg",
  remarks: "",
  is_active: true,
});

export default function ConsumptionBOMPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [dialogProductId, setDialogProductId] = useState("");
  const [lines, setLines] = useState<RecipeLine[]>([]);
  const [deletedLineIds, setDeletedLineIds] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);

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

  const linesForProduct = (productId: string): RecipeLine[] => {
    const existing = (bomEntries || [])
      .filter((b) => b.product_id === productId)
      .map((b) => ({
        id: b.id,
        raw_material_id: b.raw_material_id,
        standard_quantity: String(b.standard_quantity),
        unit: b.unit,
        remarks: b.remarks || "",
        is_active: b.is_active,
      }));
    return existing.length > 0 ? existing : [emptyLine()];
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!dialogProductId) throw new Error("Select a product first");

      // Rows the user added but left fully empty are ignored.
      const validLines = lines.filter(
        (l) => l.raw_material_id || l.standard_quantity !== ""
      );
      if (validLines.length === 0 && deletedLineIds.length === 0) {
        throw new Error("Add at least one material");
      }
      const materialIds = validLines.map((l) => l.raw_material_id);
      if (materialIds.some((id) => !id)) {
        throw new Error("Every line needs a material selected");
      }
      if (new Set(materialIds).size !== materialIds.length) {
        throw new Error("The same material is selected on more than one line");
      }
      if (validLines.some((l) => !(parseFloat(l.standard_quantity) > 0))) {
        throw new Error("Every line needs a quantity greater than 0");
      }

      for (const id of deletedLineIds) {
        const { error } = await supabase.from("consumption_bom").delete().eq("id", id);
        if (error) throw error;
      }

      for (const line of validLines) {
        const payload = {
          product_id: dialogProductId,
          raw_material_id: line.raw_material_id,
          standard_quantity: parseFloat(line.standard_quantity),
          unit: line.unit,
          remarks: line.remarks || null,
          is_active: line.is_active,
        };
        if (line.id) {
          const { error } = await supabase
            .from("consumption_bom")
            .update(payload)
            .eq("id", line.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("consumption_bom").insert(payload);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-bom"] });
      toast.success("Recipe saved");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save recipe");
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

  const handleOpenDialog = (productId?: string) => {
    setDialogProductId(productId || "");
    setLines(productId ? linesForProduct(productId) : [emptyLine()]);
    setDeletedLineIds([]);
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setDialogProductId("");
    setLines([]);
    setDeletedLineIds([]);
  };

  // Switching product loads that product's existing recipe into the editor.
  const handleDialogProductChange = (productId: string) => {
    setDialogProductId(productId);
    setLines(linesForProduct(productId));
    setDeletedLineIds([]);
  };

  const updateLine = (idx: number, patch: Partial<RecipeLine>) => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  const handleLineMaterialChange = (idx: number, materialId: string) => {
    const material = rawMaterials?.find((m) => m.id === materialId);
    updateLine(idx, { raw_material_id: materialId, unit: material?.unit || "kg" });
  };

  const removeLine = (idx: number) => {
    const line = lines[idx];
    if (line.id) setDeletedLineIds((prev) => [...prev, line.id!]);
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const handleProductSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!productFormData.code || !productFormData.name) {
      toast.error("Code and Name are required");
      return;
    }
    saveProductMutation.mutate(productFormData);
  };

  // Group BOM lines by product so each recipe reads as one block.
  const productGroups = Object.values(
    (bomEntries || []).reduce<Record<string, BOMEntry[]>>((acc, bom) => {
      (acc[bom.product_id] ||= []).push(bom);
      return acc;
    }, {})
  ).sort((a, b) => (a[0].product?.code || "").localeCompare(b[0].product?.code || ""));

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
              Add / Edit Recipe
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
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
                    <TableCell colSpan={5} className="text-center">Loading...</TableCell>
                  </TableRow>
                ) : productGroups.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      No BOM entries found. Add your first recipe.
                    </TableCell>
                  </TableRow>
                ) : (
                  productGroups.map((group) => (
                    <ProductGroup
                      key={group[0].product_id}
                      entries={group}
                      onEditRecipe={() => handleOpenDialog(group[0].product_id)}
                      onDeleteLine={setDeleteId}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Recipe Editor Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Product Recipe (BOM)</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Product *</Label>
                <Select value={dialogProductId} onValueChange={handleDialogProductChange}>
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

              {dialogProductId && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Materials *</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setLines((prev) => [...prev, emptyLine()])}
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add material
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_110px_60px_1fr_60px_32px] gap-2 text-xs font-medium text-muted-foreground px-1">
                      <span>Material</span>
                      <span>Std Qty / Unit</span>
                      <span>Unit</span>
                      <span>Remarks</span>
                      <span>Active</span>
                      <span />
                    </div>
                    {lines.map((line, idx) => (
                      <div
                        key={line.id || `new-${idx}`}
                        className="grid grid-cols-[1fr_110px_60px_1fr_60px_32px] gap-2 items-center"
                      >
                        <SearchableSelect
                          value={line.raw_material_id}
                          onValueChange={(v) => handleLineMaterialChange(idx, v)}
                          options={(rawMaterials || []).map((m) => ({
                            value: m.id,
                            label: `${m.code} - ${m.name}`,
                            secondary: `(${m.unit})`,
                          }))}
                          placeholder="Search material…"
                          emptyText="No materials match."
                        />
                        <Input
                          type="number"
                          step="0.0001"
                          min="0"
                          value={line.standard_quantity}
                          onChange={(e) => updateLine(idx, { standard_quantity: e.target.value })}
                          placeholder="0.0000"
                        />
                        <Input value={line.unit} disabled className="px-1 text-center" />
                        <Input
                          value={line.remarks}
                          onChange={(e) => updateLine(idx, { remarks: e.target.value })}
                          placeholder="Optional"
                        />
                        <div className="flex justify-center">
                          <Switch
                            checked={line.is_active}
                            onCheckedChange={(v) => updateLine(idx, { is_active: v })}
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeLine(idx)}
                        >
                          <X className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    All lines are saved together. Removing a line deletes it from the recipe when
                    you save. Intermediates (compounds) can be selected as materials here.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>Cancel</Button>
                <Button type="submit" disabled={saveMutation.isPending || !dialogProductId}>
                  {saveMutation.isPending ? "Saving..." : "Save Recipe"}
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

function ProductGroup({
  entries,
  onEditRecipe,
  onDeleteLine,
}: {
  entries: BOMEntry[];
  onEditRecipe: () => void;
  onDeleteLine: (id: string) => void;
}) {
  const product = entries[0].product;
  return (
    <>
      <TableRow className="bg-muted/50 hover:bg-muted">
        <TableCell colSpan={4}>
          <span className="font-semibold">
            {product?.code} - {product?.name}
          </span>
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({entries.length} material{entries.length === 1 ? "" : "s"})
          </span>
        </TableCell>
        <TableCell className="text-right">
          <Button variant="ghost" size="icon" onClick={onEditRecipe}>
            <Pencil className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>
      {entries.map((bom) => (
        <TableRow key={bom.id}>
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
            <Button variant="ghost" size="icon" onClick={() => onDeleteLine(bom.id)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}
