import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Plus, Pencil, Search, Factory, Settings, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";

const STOCK_CATEGORIES = [
  { value: "raw_material", label: "Raw Material" },
  { value: "inter_step", label: "Inter Step Stock" },
  { value: "finished", label: "Finished Stock" },
];

const STOCK_UNITS = [
  { value: "bags", label: "Bags" },
  { value: "sheets", label: "Sheets" },
  { value: "kg", label: "Kg" },
  { value: "litre", label: "Litre" },
];

interface StockItem {
  id: string;
  item_name: string;
  item_code: string | null;
  location_id: string | null;
  quantity: number;
  unit: string | null;
  category: string | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

interface BOMRecipe {
  id: string;
  output_item_name: string;
  output_quantity: number;
  output_unit: string;
  input_item_name: string;
  input_quantity: number;
  input_unit: string;
  is_active: boolean;
  notes: string | null;
}

export default function FloorInventoryStockPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [formData, setFormData] = useState({
    item_name: "",
    item_code: "",
    location_id: "",
    category: "raw_material",
    quantity: "",
    unit: "bags",
    remarks: "",
  });

  // Production dialogs
  const [isProductionOpen, setIsProductionOpen] = useState(false);
  const [isRecipesOpen, setIsRecipesOpen] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<BOMRecipe | null>(null);
  const [productionMultiplier, setProductionMultiplier] = useState("1");
  const [productionFromLocation, setProductionFromLocation] = useState("");
  const [productionToLocation, setProductionToLocation] = useState("");
  const [productionRemarks, setProductionRemarks] = useState("");

  // Recipe form
  const [recipeFormData, setRecipeFormData] = useState({
    output_item_name: "",
    output_quantity: "1",
    output_unit: "sheets",
    input_item_name: "",
    input_quantity: "1",
    input_unit: "sheets",
    notes: "",
  });
  const [editingRecipe, setEditingRecipe] = useState<BOMRecipe | null>(null);

  const { data: stockItems = [] } = useQuery({
    queryKey: ["floor-inventory-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("*")
        .order("item_name");
      if (error) throw error;
      return data as StockItem[];
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["floor-inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_locations")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: recipes = [] } = useQuery({
    queryKey: ["floor-inventory-bom"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_bom")
        .select("*")
        .eq("is_active", true)
        .order("output_item_name");
      if (error) throw error;
      return data as BOMRecipe[];
    },
  });

  const { data: allItemNames = [] } = useQuery({
    queryKey: ["floor-inventory-stock-item-names-raw"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("item_name, unit, category")
        .eq("category", "raw_material")
        .order("item_name");
      if (error) throw error;
      const unique = [...new Map(data.map((i: any) => [i.item_name, i])).values()];
      return unique as { item_name: string; unit: string; category: string }[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingItem) {
        const { error } = await supabase
          .from("floor_inventory_stock")
          .update({
            item_name: data.item_name,
            item_code: data.item_code || null,
            location_id: data.location_id || null,
            category: data.category,
            quantity: Number(data.quantity),
            unit: data.unit,
            remarks: data.remarks || null,
          })
          .eq("id", editingItem.id);
        if (error) throw error;
      } else {
        // Insert stock record
        const { error } = await supabase.from("floor_inventory_stock").insert({
          item_name: data.item_name,
          item_code: data.item_code || null,
          location_id: data.location_id || null,
          category: data.category,
          quantity: Number(data.quantity),
          unit: data.unit,
          remarks: data.remarks || null,
        });
        if (error) throw error;

        // If quantity > 0 and location is specified, create opening balance movement
        const qty = Number(data.quantity);
        if (qty > 0 && data.location_id) {
          const { error: movementError } = await supabase
            .from("floor_inventory_movements")
            .insert({
              item_name: data.item_name,
              movement_type: "receipt",
              quantity: qty,
              unit: data.unit,
              to_location_id: data.location_id,
              reference_type: "internal",
              remarks: "Opening Balance",
              status: "completed",
            });
          if (movementError) throw movementError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-ledger"] });
      toast.success(editingItem ? "Stock updated" : "Stock item added");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save stock");
    },
  });

  const saveRecipeMutation = useMutation({
    mutationFn: async (data: typeof recipeFormData) => {
      if (editingRecipe) {
        const { error } = await supabase
          .from("floor_inventory_bom")
          .update({
            output_item_name: data.output_item_name,
            output_quantity: Number(data.output_quantity),
            output_unit: data.output_unit,
            input_item_name: data.input_item_name,
            input_quantity: Number(data.input_quantity),
            input_unit: data.input_unit,
            notes: data.notes || null,
          })
          .eq("id", editingRecipe.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("floor_inventory_bom").insert({
          output_item_name: data.output_item_name,
          output_quantity: Number(data.output_quantity),
          output_unit: data.output_unit,
          input_item_name: data.input_item_name,
          input_quantity: Number(data.input_quantity),
          input_unit: data.input_unit,
          notes: data.notes || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-bom"] });
      toast.success(editingRecipe ? "Recipe updated" : "Recipe created");
      resetRecipeForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save recipe");
    },
  });

  const deleteRecipeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("floor_inventory_bom")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-bom"] });
      toast.success("Recipe deleted");
    },
  });

  const executeProductionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRecipe) throw new Error("No recipe selected");
      const { error } = await supabase.rpc("floor_inventory_execute_production", {
        p_bom_id: selectedRecipe.id,
        p_multiplier: Number(productionMultiplier),
        p_from_location_id: productionFromLocation || null,
        p_to_location_id: productionToLocation || null,
        p_remarks: productionRemarks || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-ledger"] });
      toast.success("Production completed successfully");
      resetProductionForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Production failed");
    },
  });

  const resetForm = () => {
    setFormData({
      item_name: "",
      item_code: "",
      location_id: "",
      category: "raw_material",
      quantity: "",
      unit: "bags",
      remarks: "",
    });
    setEditingItem(null);
    setIsDialogOpen(false);
  };

  const resetRecipeForm = () => {
    setRecipeFormData({
      output_item_name: "",
      output_quantity: "1",
      output_unit: "sheets",
      input_item_name: "",
      input_quantity: "1",
      input_unit: "sheets",
      notes: "",
    });
    setEditingRecipe(null);
  };

  const resetProductionForm = () => {
    setSelectedRecipe(null);
    setProductionMultiplier("1");
    setProductionFromLocation("");
    setProductionToLocation("");
    setProductionRemarks("");
    setIsProductionOpen(false);
  };

  const handleEdit = (item: StockItem) => {
    setEditingItem(item);
    setFormData({
      item_name: item.item_name,
      item_code: item.item_code || "",
      location_id: item.location_id || "",
      category: item.category || "raw_material",
      quantity: item.quantity.toString(),
      unit: item.unit || "bags",
      remarks: item.remarks || "",
    });
    setIsDialogOpen(true);
  };

  const handleEditRecipe = (recipe: BOMRecipe) => {
    setEditingRecipe(recipe);
    setRecipeFormData({
      output_item_name: recipe.output_item_name,
      output_quantity: recipe.output_quantity.toString(),
      output_unit: recipe.output_unit,
      input_item_name: recipe.input_item_name,
      input_quantity: recipe.input_quantity.toString(),
      input_unit: recipe.input_unit,
      notes: recipe.notes || "",
    });
  };

  const handleSubmit = () => {
    if (!formData.item_name || !formData.quantity) {
      toast.error("Please fill required fields");
      return;
    }
    saveMutation.mutate(formData);
  };

  const handleSubmitRecipe = () => {
    if (!recipeFormData.output_item_name || !recipeFormData.input_item_name) {
      toast.error("Please fill required fields");
      return;
    }
    saveRecipeMutation.mutate(recipeFormData);
  };

  const handleExecuteProduction = () => {
    if (!selectedRecipe) {
      toast.error("Please select a recipe");
      return;
    }
    if (!productionFromLocation || !productionToLocation) {
      toast.error("Please select both locations");
      return;
    }
    executeProductionMutation.mutate();
  };

  const getLocationName = (locationId: string | null) => {
    if (!locationId) return "-";
    const location = locations.find((l: any) => l.id === locationId);
    return location?.name || "-";
  };

  const getCategoryLabel = (category: string | null) => {
    const cat = STOCK_CATEGORIES.find((c) => c.value === category);
    return cat?.label || "Raw Material";
  };

  const filteredStock = stockItems.filter((item) => {
    const matchesSearch =
      item.item_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.item_code && item.item_code.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchesLocation =
      filterLocation === "all" || item.location_id === filterLocation;
    return matchesSearch && matchesLocation;
  });

  const totalQuantity = filteredStock.reduce((sum, item) => sum + Number(item.quantity), 0);

  // Calculate production preview
  const inputQty = selectedRecipe
    ? selectedRecipe.input_quantity * Number(productionMultiplier || 0)
    : 0;
  const outputQty = selectedRecipe
    ? selectedRecipe.output_quantity * Number(productionMultiplier || 0)
    : 0;

  const columns = [
    {
      key: "item_name",
      header: "Item Name",
      render: (item: StockItem) => <span className="font-medium">{item.item_name}</span>,
    },
    {
      key: "item_code",
      header: "Code",
      render: (item: StockItem) => item.item_code || "-",
    },
    {
      key: "category",
      header: "Category",
      render: (item: StockItem) => (
        <span className="text-xs px-2 py-1 rounded-full bg-muted">
          {getCategoryLabel(item.category)}
        </span>
      ),
    },
    {
      key: "location_id",
      header: "Location",
      render: (item: StockItem) => getLocationName(item.location_id),
    },
    {
      key: "quantity",
      header: "Quantity",
      render: (item: StockItem) => (
        <span className="font-semibold">
          {item.quantity.toLocaleString()} {item.unit}
        </span>
      ),
    },
    {
      key: "updated_at",
      header: "Last Updated",
      render: (item: StockItem) => format(new Date(item.updated_at), "dd MMM yyyy"),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: StockItem) => (
        <Button variant="ghost" size="sm" onClick={() => handleEdit(item)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Floor Stock Levels"
        description="Current stock on the production floor"
        icon={Package}
        action={{
          label: "Add Stock",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        }}
      />

      {/* Action Buttons */}
      <div className="flex gap-2 mb-6">
        <Button variant="outline" onClick={() => setIsRecipesOpen(true)} className="gap-2">
          <Settings className="h-4 w-4" />
          Manage Recipes
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filterLocation} onValueChange={setFilterLocation}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue placeholder="All Locations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Locations</SelectItem>
            {locations.map((loc: any) => (
              <SelectItem key={loc.id} value={loc.id}>
                {loc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Summary */}
      <div className="flex gap-4 mb-4 text-sm text-muted-foreground">
        <span>{filteredStock.length} items</span>
        <span>•</span>
        <span>Total: {totalQuantity.toLocaleString()} units</span>
      </div>

      <DataTable columns={columns} data={filteredStock} />

      {/* Add/Edit Stock Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Stock Item" : "Add Stock Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Item Name *</Label>
              <Select
                value={formData.item_name || "__new__"}
                onValueChange={(v) => {
                  if (v === "__new__") {
                    setFormData({ ...formData, item_name: "", category: "raw_material" });
                  } else {
                    const selectedItem = allItemNames.find(i => i.item_name === v);
                    setFormData({ 
                      ...formData, 
                      item_name: v,
                      unit: selectedItem?.unit || formData.unit,
                      category: "raw_material"
                    });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select or enter item name" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__new__">-- Enter New Item --</SelectItem>
                  {allItemNames.map((item) => (
                    <SelectItem key={item.item_name} value={item.item_name}>
                      {item.item_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {(formData.item_name === "" || !allItemNames.some(i => i.item_name === formData.item_name)) && (
                <Input
                  value={formData.item_name}
                  onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                  placeholder="Enter new item name"
                  className="mt-2"
                />
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Item Code</Label>
                <Input
                  value={formData.item_code}
                  onChange={(e) => setFormData({ ...formData, item_code: e.target.value })}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value="raw_material"
                  disabled={true}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Raw Material" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="raw_material">Raw Material</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Only raw materials can be added via this form</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Select
                value={formData.location_id || "none"}
                onValueChange={(v) => setFormData({ ...formData, location_id: v === "none" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {locations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Select
                  value={formData.unit}
                  onValueChange={(v) => setFormData({ ...formData, unit: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select unit" />
                  </SelectTrigger>
                  <SelectContent>
                    {STOCK_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                placeholder="Additional notes..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {editingItem ? "Update" : "Add"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Production Dialog */}
      <Dialog open={isProductionOpen} onOpenChange={setIsProductionOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Factory className="h-5 w-5" />
              Execute Production
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm">Select Recipe *</Label>
              <Select
                value={selectedRecipe?.id || ""}
                onValueChange={(v) => setSelectedRecipe(recipes.find((r) => r.id === v) || null)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a recipe" />
                </SelectTrigger>
                <SelectContent>
                  {recipes.map((recipe) => (
                    <SelectItem key={recipe.id} value={recipe.id}>
                      {recipe.input_item_name} → {recipe.output_item_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedRecipe && (
              <div className="text-xs p-2 bg-muted rounded-md space-y-0.5">
                <p><strong>In:</strong> {selectedRecipe.input_quantity} {selectedRecipe.input_unit} {selectedRecipe.input_item_name}</p>
                <p><strong>Out:</strong> {selectedRecipe.output_quantity} {selectedRecipe.output_unit} {selectedRecipe.output_item_name}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-sm">Multiplier (Batches) *</Label>
              <Input
                type="number"
                min="1"
                value={productionMultiplier}
                onChange={(e) => setProductionMultiplier(e.target.value)}
                placeholder="1"
              />
            </div>

            {selectedRecipe && Number(productionMultiplier) > 0 && (
              <div className="text-xs p-2 border border-primary rounded-md space-y-0.5">
                <p className="font-medium text-xs">Preview:</p>
                <p className="text-destructive">Consume: {inputQty} {selectedRecipe.input_unit} {selectedRecipe.input_item_name}</p>
                <p className="text-primary">Produce: {outputQty} {selectedRecipe.output_unit} {selectedRecipe.output_item_name}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm">From Location *</Label>
                <Select value={productionFromLocation} onValueChange={setProductionFromLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc: any) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">To Location *</Label>
                <Select value={productionToLocation} onValueChange={setProductionToLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc: any) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-sm">Remarks</Label>
              <Input
                value={productionRemarks}
                onChange={(e) => setProductionRemarks(e.target.value)}
                placeholder="Optional notes..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={resetProductionForm}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleExecuteProduction} disabled={executeProductionMutation.isPending}>
              Execute
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Recipes Dialog */}
      <Dialog open={isRecipesOpen} onOpenChange={setIsRecipesOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Settings className="h-4 w-4" />
              Production Recipes
            </DialogTitle>
          </DialogHeader>

          {/* Recipe Form */}
          <div className="border rounded-md p-3 space-y-3 bg-muted/30">
            <p className="text-sm font-medium">{editingRecipe ? "Edit Recipe" : "Add Recipe"}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Input Item *</Label>
                <Select
                  value={recipeFormData.input_item_name}
                  onValueChange={(v) => {
                    const item = allItemNames.find((i) => i.item_name === v);
                    setRecipeFormData({
                      ...recipeFormData,
                      input_item_name: v,
                      input_unit: item?.unit || recipeFormData.input_unit,
                    });
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {allItemNames.map((item) => (
                      <SelectItem key={item.item_name} value={item.item_name}>
                        {item.item_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Input Qty *</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    value={recipeFormData.input_quantity}
                    onChange={(e) => setRecipeFormData({ ...recipeFormData, input_quantity: e.target.value })}
                    className="h-9 w-16"
                  />
                  <Input
                    value={recipeFormData.input_unit}
                    onChange={(e) => setRecipeFormData({ ...recipeFormData, input_unit: e.target.value })}
                    placeholder="unit"
                    className="h-9"
                  />
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Output Item *</Label>
                <Select
                  value={recipeFormData.output_item_name}
                  onValueChange={(v) => {
                    const item = allItemNames.find((i) => i.item_name === v);
                    setRecipeFormData({
                      ...recipeFormData,
                      output_item_name: v,
                      output_unit: item?.unit || recipeFormData.output_unit,
                    });
                  }}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {allItemNames.map((item) => (
                      <SelectItem key={item.item_name} value={item.item_name}>
                        {item.item_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Output Qty *</Label>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    value={recipeFormData.output_quantity}
                    onChange={(e) => setRecipeFormData({ ...recipeFormData, output_quantity: e.target.value })}
                    className="h-9 w-16"
                  />
                  <Input
                    value={recipeFormData.output_unit}
                    onChange={(e) => setRecipeFormData({ ...recipeFormData, output_unit: e.target.value })}
                    placeholder="unit"
                    className="h-9"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSubmitRecipe} disabled={saveRecipeMutation.isPending}>
                {editingRecipe ? "Update" : "Add"}
              </Button>
              {editingRecipe && (
                <Button variant="outline" size="sm" onClick={resetRecipeForm}>
                  Cancel
                </Button>
              )}
            </div>
          </div>

          {/* Existing Recipes */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Existing Recipes</p>
            {recipes.length === 0 ? (
              <p className="text-xs text-muted-foreground">No recipes yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {recipes.map((recipe) => (
                  <div key={recipe.id} className="flex items-center justify-between p-2 border rounded text-xs">
                    <span>
                      <span className="font-medium">{recipe.input_item_name}</span>
                      <span className="text-muted-foreground"> ({recipe.input_quantity})</span>
                      <span className="mx-1">→</span>
                      <span className="font-medium">{recipe.output_item_name}</span>
                      <span className="text-muted-foreground"> ({recipe.output_quantity})</span>
                    </span>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleEditRecipe(recipe)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteRecipeMutation.mutate(recipe.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
