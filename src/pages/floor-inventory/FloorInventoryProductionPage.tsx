import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Search, Plus, Pencil, Trash2, Factory, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

interface ProductionEntry {
  id: string;
  movement_date: string;
  movement_number: string;
  item_name: string;
  quantity: number;
  unit: string;
  movement_type: "issue" | "receipt";
  from_location_id: string | null;
  to_location_id: string | null;
  remarks: string | null;
  created_at: string;
}

interface ProductionGroup {
  id: string;
  date: string;
  inputItem: string;
  inputQty: number;
  inputUnit: string;
  outputItem: string;
  outputQty: number;
  outputUnit: string;
  fromLocation: string | null;
  toLocation: string | null;
  remarks: string | null;
  issueId: string;
  receiptId: string;
}

interface Location {
  id: string;
  name: string;
}

interface BOMRecipe {
  id: string;
  input_item_name: string;
  input_quantity: number;
  input_unit: string;
  output_item_name: string;
  output_quantity: number;
  output_unit: string;
}

interface FloorItem {
  item_name: string;
  production_floor: string | null;
}

const FloorInventoryProductionPage = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedProduction, setSelectedProduction] = useState<ProductionGroup | null>(null);

  // New production form state
  const [selectedRecipe, setSelectedRecipe] = useState<BOMRecipe | null>(null);
  const [productionMultiplier, setProductionMultiplier] = useState("1");
  const [productionFromLocation, setProductionFromLocation] = useState("");
  const [productionToLocation, setProductionToLocation] = useState("");
  const [productionRemarks, setProductionRemarks] = useState("");
  const [productionDate, setProductionDate] = useState<Date>(new Date());

  // Edit form state
  const [editInputQty, setEditInputQty] = useState("");
  const [editOutputQty, setEditOutputQty] = useState("");
  const [editFromLocation, setEditFromLocation] = useState("");
  const [editToLocation, setEditToLocation] = useState("");
  const [editRemarks, setEditRemarks] = useState("");

  // Fetch production movements
  const { data: productionMovements = [], isLoading } = useQuery({
    queryKey: ["floor-inventory-production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_movements")
        .select("*")
        .eq("reference_type", "production")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ProductionEntry[];
    },
  });

  // Fetch locations
  const { data: locations = [] } = useQuery({
    queryKey: ["floor-inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_locations")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
  });

  // Fetch BOM recipes
  const { data: bomRecipes = [] } = useQuery({
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

  // Fetch floor inventory items to get production_floor mapping
  const { data: floorItems = [] } = useQuery({
    queryKey: ["floor-inventory-items-for-production"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("item_name, production_floor")
        .order("item_name");
      if (error) throw error;
      // Deduplicate by item_name
      const uniqueItems: FloorItem[] = [];
      const seen = new Set<string>();
      data.forEach((item) => {
        if (!seen.has(item.item_name)) {
          seen.add(item.item_name);
          uniqueItems.push(item);
        }
      });
      return uniqueItems;
    },
  });

  // Group production movements (issue + receipt pairs)
  const productionGroups: ProductionGroup[] = [];
  const processedIds = new Set<string>();

  productionMovements.forEach((movement) => {
    if (processedIds.has(movement.id)) return;

    if (movement.movement_type === "issue") {
      // Find matching receipt
      const receipt = productionMovements.find(
        (m) =>
          m.movement_type === "receipt" &&
          m.remarks === movement.remarks &&
          m.movement_date === movement.movement_date &&
          !processedIds.has(m.id)
      );

      if (receipt) {
        processedIds.add(movement.id);
        processedIds.add(receipt.id);

        productionGroups.push({
          id: movement.id,
          date: movement.movement_date,
          inputItem: movement.item_name,
          inputQty: movement.quantity,
          inputUnit: movement.unit,
          outputItem: receipt.item_name,
          outputQty: receipt.quantity,
          outputUnit: receipt.unit,
          fromLocation: movement.from_location_id,
          toLocation: receipt.to_location_id,
          remarks: movement.remarks,
          issueId: movement.id,
          receiptId: receipt.id,
        });
      }
    }
  });

  const getLocationName = (id: string | null) => {
    if (!id) return "-";
    return locations.find((l) => l.id === id)?.name || "-";
  };

  // Execute new production
  const executeProductionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRecipe) throw new Error("No recipe selected");
      const { error } = await supabase.rpc("floor_inventory_execute_production", {
        p_bom_id: selectedRecipe.id,
        p_multiplier: Number(productionMultiplier),
        p_from_location_id: productionFromLocation || null,
        p_to_location_id: productionToLocation || null,
        p_remarks: productionRemarks || null,
        p_production_date: format(productionDate, "yyyy-MM-dd"),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-production"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-ledger"] });
      toast.success("Production completed successfully");
      resetAddForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Production failed");
    },
  });

  // Update production entries
  const updateProductionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduction) throw new Error("No production selected");

      // Update the issue movement
      const { error: issueError } = await supabase
        .from("floor_inventory_movements")
        .update({
          quantity: Number(editInputQty),
          from_location_id: editFromLocation || null,
          remarks: editRemarks || null,
        })
        .eq("id", selectedProduction.issueId);
      if (issueError) throw issueError;

      // Update the receipt movement
      const { error: receiptError } = await supabase
        .from("floor_inventory_movements")
        .update({
          quantity: Number(editOutputQty),
          to_location_id: editToLocation || null,
          remarks: editRemarks || null,
        })
        .eq("id", selectedProduction.receiptId);
      if (receiptError) throw receiptError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-production"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      toast.success("Production updated");
      setIsEditDialogOpen(false);
      setSelectedProduction(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update");
    },
  });

  // Delete production entries
  const deleteProductionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedProduction) throw new Error("No production selected");

      // First, delete ledger records referencing these movements
      const { error: ledgerIssueError } = await supabase
        .from("floor_inventory_ledger")
        .delete()
        .eq("movement_id", selectedProduction.issueId);
      if (ledgerIssueError) throw ledgerIssueError;

      const { error: ledgerReceiptError } = await supabase
        .from("floor_inventory_ledger")
        .delete()
        .eq("movement_id", selectedProduction.receiptId);
      if (ledgerReceiptError) throw ledgerReceiptError;

      // Then delete both issue and receipt movements
      const { error: issueError } = await supabase
        .from("floor_inventory_movements")
        .delete()
        .eq("id", selectedProduction.issueId);
      if (issueError) throw issueError;

      const { error: receiptError } = await supabase
        .from("floor_inventory_movements")
        .delete()
        .eq("id", selectedProduction.receiptId);
      if (receiptError) throw receiptError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-production"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-ledger"] });
      toast.success("Production deleted");
      setIsDeleteDialogOpen(false);
      setSelectedProduction(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete");
    },
  });

  const resetAddForm = () => {
    setIsAddDialogOpen(false);
    setSelectedRecipe(null);
    setProductionMultiplier("1");
    setProductionFromLocation("");
    setProductionToLocation("");
    setProductionRemarks("");
    setProductionDate(new Date());
  };

  const handleEdit = (production: ProductionGroup) => {
    setSelectedProduction(production);
    setEditInputQty(String(production.inputQty));
    setEditOutputQty(String(production.outputQty));
    setEditFromLocation(production.fromLocation || "");
    setEditToLocation(production.toLocation || "");
    setEditRemarks(production.remarks || "");
    setIsEditDialogOpen(true);
  };

  const handleDelete = (production: ProductionGroup) => {
    setSelectedProduction(production);
    setIsDeleteDialogOpen(true);
  };

  const filteredProductions = productionGroups.filter(
    (p) =>
      p.inputItem.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.outputItem.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const inputQty = selectedRecipe
    ? Number(selectedRecipe.input_quantity) * Number(productionMultiplier || 0)
    : 0;
  const outputQty = selectedRecipe
    ? Number(selectedRecipe.output_quantity) * Number(productionMultiplier || 0)
    : 0;

  const columns = [
    {
      key: "date",
      header: "Date",
      render: (row) => format(new Date(row.date), "dd MMM yyyy"),
    },
    {
      key: "inputItem",
      header: "Input Item",
    },
    {
      key: "inputQty",
      header: "Input Qty",
      render: (row) => `${row.inputQty} ${row.inputUnit}`,
    },
    {
      key: "outputItem",
      header: "Output Item",
    },
    {
      key: "outputQty",
      header: "Output Qty",
      render: (row) => `${row.outputQty} ${row.outputUnit}`,
    },
    {
      key: "fromLocation",
      header: "From Location",
      render: (row) => getLocationName(row.fromLocation),
    },
    {
      key: "toLocation",
      header: "To Location",
      render: (row) => getLocationName(row.toLocation),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleEdit(row);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row);
            }}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Production"
          description="Floor inventory production entries"
          icon={Factory}
          action={{
            label: "New Production",
            icon: Plus,
            onClick: () => setIsAddDialogOpen(true),
          }}
        />

        {/* Search */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by item name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Data Table */}
        <DataTable
          columns={columns}
          data={filteredProductions}
          emptyMessage={isLoading ? "Loading..." : "No production entries found"}
        />

        {/* Add Production Dialog */}
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Execute Production</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Production Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !productionDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {productionDate ? format(productionDate, "dd MMM yyyy") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={productionDate}
                      onSelect={(date) => date && setProductionDate(date)}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-2">
                <Label>Production Output Item</Label>
                <Select
                  value={selectedRecipe?.id || ""}
                  onValueChange={(val) => {
                    const recipe = bomRecipes.find((r) => r.id === val) || null;
                    setSelectedRecipe(recipe);
                    // Auto-set locations based on output item's production_floor
                    if (recipe) {
                      const outputItem = floorItems.find(i => i.item_name === recipe.output_item_name);
                      if (outputItem?.production_floor) {
                        // Both from and to locations are the output item's production floor
                        setProductionFromLocation(outputItem.production_floor);
                        setProductionToLocation(outputItem.production_floor);
                      } else {
                        // Fallback to input item's floor if output has none
                        const inputItem = floorItems.find(i => i.item_name === recipe.input_item_name);
                        if (inputItem?.production_floor) {
                          setProductionFromLocation(inputItem.production_floor);
                          setProductionToLocation(inputItem.production_floor);
                        }
                      }
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select output item" />
                  </SelectTrigger>
                  <SelectContent>
                    {bomRecipes.map((recipe) => (
                      <SelectItem key={recipe.id} value={recipe.id}>
                        {recipe.output_item_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedRecipe && (
                <>
                  <div className="p-3 bg-muted rounded-lg text-sm space-y-1">
                    <p className="font-medium text-muted-foreground">Recipe Details</p>
                    <p>
                      <strong>Input:</strong> {selectedRecipe.input_quantity}{" "}
                      {selectedRecipe.input_unit} of {selectedRecipe.input_item_name}
                    </p>
                    <p>
                      <strong>Output:</strong> {selectedRecipe.output_quantity}{" "}
                      {selectedRecipe.output_unit} of {selectedRecipe.output_item_name}
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Production (Multiplier)</Label>
                    <Input
                      type="number"
                      value={productionMultiplier}
                      onChange={(e) => setProductionMultiplier(e.target.value)}
                      min="0.01"
                      step="0.01"
                    />
                    <p className="text-xs text-muted-foreground">
                      Will consume {inputQty.toFixed(2)} {selectedRecipe.input_unit} and
                      produce {outputQty.toFixed(2)} {selectedRecipe.output_unit}
                    </p>
                  </div>
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={resetAddForm}>
                Cancel
              </Button>
              <Button
                onClick={() => executeProductionMutation.mutate()}
                disabled={!selectedRecipe || executeProductionMutation.isPending}
              >
                {executeProductionMutation.isPending ? "Processing..." : "Execute"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Production Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Production</DialogTitle>
            </DialogHeader>
            {selectedProduction && (
              <div className="space-y-4 py-4">
                <div className="p-3 bg-muted rounded-lg text-sm">
                  <p>
                    <strong>Input:</strong> {selectedProduction.inputItem}
                  </p>
                  <p>
                    <strong>Output:</strong> {selectedProduction.outputItem}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Input Quantity ({selectedProduction.inputUnit})</Label>
                    <Input
                      type="number"
                      value={editInputQty}
                      onChange={(e) => setEditInputQty(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Output Quantity ({selectedProduction.outputUnit})</Label>
                    <Input
                      type="number"
                      value={editOutputQty}
                      onChange={(e) => setEditOutputQty(e.target.value)}
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>From Location</Label>
                    <Select 
                      value={editFromLocation || "__none__"} 
                      onValueChange={(v) => setEditFromLocation(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">-- None --</SelectItem>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>To Location</Label>
                    <Select 
                      value={editToLocation || "__none__"} 
                      onValueChange={(v) => setEditToLocation(v === "__none__" ? "" : v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">-- None --</SelectItem>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Remarks</Label>
                  <Textarea
                    value={editRemarks}
                    onChange={(e) => setEditRemarks(e.target.value)}
                    placeholder="Optional remarks"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => updateProductionMutation.mutate()}
                disabled={updateProductionMutation.isPending}
              >
                {updateProductionMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Production Entry?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this production entry and its associated
                movements. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteProductionMutation.mutate()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteProductionMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
};

export default FloorInventoryProductionPage;
