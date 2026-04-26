import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Boxes, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ITEM_CATEGORIES = [
  { value: "raw_material", label: "Raw Material" },
  { value: "inter_step", label: "Inter Step Stock" },
  { value: "finished", label: "Finished Stock" },
];

const ITEM_UNITS = [
  { value: "bags", label: "Bags" },
  { value: "sheets", label: "Sheets" },
  { value: "kg", label: "Kg" },
  { value: "litre", label: "Litre" },
];

interface FloorItem {
  id: string;
  item_code: string | null;
  item_name: string;
  category: string | null;
  unit: string | null;
  production_floor: string | null;
  is_active: boolean | null;
  created_at: string | null;
}

export default function FloorInventoryItemsPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<FloorItem | null>(null);
  const [deleteItem, setDeleteItem] = useState<FloorItem | null>(null);
  const [formData, setFormData] = useState({
    item_code: "",
    item_name: "",
    category: "raw_material",
    unit: "bags",
    production_floor: "",
    is_active: true,
  });

  // Fetch locations for production floor dropdown
  const { data: locations = [] } = useQuery({
    queryKey: ["floor-inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_locations")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["floor-inventory-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("id, item_code, item_name, category, unit, production_floor, created_at")
        .order("item_name");
      if (error) throw error;
      // Deduplicate by item_name to get unique items
      const uniqueItems = data.reduce((acc: FloorItem[], curr) => {
        if (!acc.find(item => item.item_name === curr.item_name)) {
          acc.push({ ...curr, is_active: true });
        }
        return acc;
      }, []);
      return uniqueItems;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingItem) {
        // Update all stock records with this item name
        const { error } = await supabase
          .from("floor_inventory_stock")
          .update({
            item_name: data.item_name,
            item_code: data.item_code || null,
            category: data.category,
            unit: data.unit,
            production_floor: data.production_floor || null,
          })
          .eq("item_name", editingItem.item_name);
        if (error) throw error;
      } else {
        // Create a new item entry with 0 quantity
        const { error } = await supabase.from("floor_inventory_stock").insert({
          item_name: data.item_name,
          item_code: data.item_code || null,
          category: data.category,
          unit: data.unit,
          production_floor: data.production_floor || null,
          quantity: 0,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      toast.success(editingItem ? "Item updated" : "Item added");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save item");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (item: FloorItem) => {
      // Check if item has any movements
      const { data: movements, error: movError } = await supabase
        .from("floor_inventory_movements")
        .select("id")
        .eq("item_name", item.item_name)
        .limit(1);
      if (movError) throw movError;
      
      if (movements && movements.length > 0) {
        throw new Error("Cannot delete item with existing movements. Delete movements first.");
      }

      // Check if item has any ledger entries
      const { data: ledgerEntries, error: ledgerError } = await supabase
        .from("floor_inventory_ledger")
        .select("id")
        .eq("item_name", item.item_name)
        .limit(1);
      if (ledgerError) throw ledgerError;

      if (ledgerEntries && ledgerEntries.length > 0) {
        throw new Error("Cannot delete item with existing ledger entries. Clear ledger first.");
      }

      const { error } = await supabase
        .from("floor_inventory_stock")
        .delete()
        .eq("item_name", item.item_name);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      toast.success("Item deleted");
      setDeleteItem(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete item");
    },
  });

  const resetForm = () => {
    setFormData({
      item_code: "",
      item_name: "",
      category: "raw_material",
      unit: "bags",
      production_floor: "",
      is_active: true,
    });
    setEditingItem(null);
    setIsDialogOpen(false);
  };

  const handleEdit = (item: FloorItem) => {
    setEditingItem(item);
    setFormData({
      item_code: item.item_code || "",
      item_name: item.item_name,
      category: item.category || "raw_material",
      unit: item.unit || "bags",
      production_floor: item.production_floor || "",
      is_active: item.is_active ?? true,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.item_name) {
      toast.error("Item name is required");
      return;
    }
    saveMutation.mutate(formData);
  };

  const getCategoryLabel = (category: string | null) => {
    return ITEM_CATEGORIES.find((c) => c.value === category)?.label || "Raw Material";
  };

  const getUnitLabel = (unit: string | null) => {
    return ITEM_UNITS.find((u) => u.value === unit)?.label || unit || "-";
  };

  const columns = [
    {
      key: "item_code",
      header: "Code",
      render: (item: FloorItem) => item.item_code || "-",
    },
    {
      key: "item_name",
      header: "Item Name",
      render: (item: FloorItem) => <span className="font-medium">{item.item_name}</span>,
    },
    {
      key: "category",
      header: "Category",
      render: (item: FloorItem) => (
        <span className="text-xs px-2 py-1 rounded-full bg-muted">
          {getCategoryLabel(item.category)}
        </span>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      render: (item: FloorItem) => getUnitLabel(item.unit),
    },
    {
      key: "production_floor",
      header: "Floor Location",
      render: (item: FloorItem) => {
        const loc = locations.find(l => l.id === item.production_floor);
        const floorType = item.category === "raw_material" ? "Storage" : "Production";
        return loc?.name ? `${loc.name}` : "-";
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: FloorItem) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => handleEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setDeleteItem(item)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Floor Inventory Items"
        description="Manage items for floor inventory tracking"
        icon={Boxes}
        action={{
          label: "Add Item",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        }}
      />

      <DataTable columns={columns} data={items} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Item" : "Add Item"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
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
                <Label>Item Name *</Label>
                <Input
                  value={formData.item_name}
                  onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
                  placeholder="Enter item name"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Select
                  value={formData.category}
                  onValueChange={(v) => setFormData({ ...formData, category: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {ITEM_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    {ITEM_UNITS.map((u) => (
                      <SelectItem key={u.value} value={u.value}>
                        {u.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>
                {formData.category === "raw_material" ? "Storage Floor" : "Production Floor"}
              </Label>
              <Select
                value={formData.production_floor || "__none__"}
                onValueChange={(v) => setFormData({ ...formData, production_floor: v === "__none__" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={formData.category === "raw_material" ? "Select storage floor" : "Select production floor"} />
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

      <AlertDialog open={!!deleteItem} onOpenChange={() => setDeleteItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Item?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete "{deleteItem?.item_name}" and all associated stock records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteItem && deleteMutation.mutate(deleteItem)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
