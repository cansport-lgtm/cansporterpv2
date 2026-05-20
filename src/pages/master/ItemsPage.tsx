import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Database, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
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
import type { Database as SupabaseDatabase } from "@/integrations/supabase/types";

type PurchaseCategory = SupabaseDatabase["public"]["Enums"]["purchase_category"];

interface Item {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: PurchaseCategory | null;
  uom_id: string | null;
  unit_price: number | null;
  min_stock: number | null;
  max_stock: number | null;
  reorder_level: number | null;
  is_inventory_item: boolean | null;
  is_active: boolean | null;
  consumption_raw_material_id: string | null;
  units_of_measure?: { name: string } | null;
  consumption_raw_materials?: { code: string; name: string } | null;
}

const CATEGORIES: { value: PurchaseCategory; label: string }[] = [
  { value: "raw_material", label: "Raw Material" },
  { value: "office_supplies", label: "Office Supplies" },
  { value: "general_supplies", label: "General Supplies" },
  { value: "spare_maintenance", label: "Spare & Maintenance" },
];

export default function ItemsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    category: "" as PurchaseCategory | "",
    uom_id: "",
    unit_price: 0,
    min_stock: 0,
    max_stock: 0,
    reorder_level: 0,
    is_inventory_item: true,
    is_active: true,
    consumption_raw_material_id: "",
  });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*, units_of_measure(name), consumption_raw_materials(code, name)")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Item[];
    },
  });

  const { data: availableRawMaterials = [] } = useQuery({
    queryKey: ["consumption-raw-materials-available", selectedItem?.id],
    queryFn: async () => {
      // Show RMs that are unlinked, plus the one currently linked to the
      // item being edited (so it stays selectable in the dropdown).
      const linkedRows = (items as Item[])
        .filter((i) => i.consumption_raw_material_id && i.id !== selectedItem?.id)
        .map((i) => i.consumption_raw_material_id as string);

      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("id, code, name, unit")
        .eq("is_active", true)
        .order("code");
      if (error) throw error;
      return (data || []).filter((rm: any) => !linkedRows.includes(rm.id));
    },
    enabled: dialogOpen,
  });

  const { data: uoms = [] } = useQuery({
    queryKey: ["uoms-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units_of_measure")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      const payload = {
        code: data.code,
        name: data.name,
        description: data.description || null,
        category: data.category || null,
        uom_id: data.uom_id || null,
        unit_price: data.unit_price,
        min_stock: data.min_stock,
        max_stock: data.max_stock,
        reorder_level: data.reorder_level,
        is_inventory_item: data.is_inventory_item,
        is_active: data.is_active,
        consumption_raw_material_id: data.consumption_raw_material_id || null,
      };

      if (data.id) {
        const { error } = await supabase
          .from("items")
          .update(payload)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("items").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success(selectedItem ? "Item updated" : "Item created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["items"] });
      toast.success("Item deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      category: "",
      uom_id: "",
      unit_price: 0,
      min_stock: 0,
      max_stock: 0,
      reorder_level: 0,
      is_inventory_item: true,
      is_active: true,
      consumption_raw_material_id: "",
    });
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: Item) => {
    setSelectedItem(item);
    setFormData({
      code: item.code,
      name: item.name,
      description: item.description || "",
      category: item.category || "",
      uom_id: item.uom_id || "",
      unit_price: item.unit_price || 0,
      min_stock: item.min_stock || 0,
      max_stock: item.max_stock || 0,
      reorder_level: item.reorder_level || 0,
      is_inventory_item: item.is_inventory_item ?? true,
      is_active: item.is_active ?? true,
      consumption_raw_material_id: item.consumption_raw_material_id || "",
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: Item) => {
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "category",
      header: "Category",
      render: (item: Item) =>
        CATEGORIES.find((c) => c.value === item.category)?.label || "-",
    },
    {
      key: "units_of_measure.name",
      header: "UOM",
      render: (item: Item) => item.units_of_measure?.name || "-",
    },
    {
      key: "unit_price",
      header: "Unit Price",
      render: (item: Item) => `Rs. ${item.unit_price?.toLocaleString() || 0}`,
    },
    {
      key: "consumption_raw_materials",
      header: "Linked Raw Material",
      render: (item: Item) =>
        item.consumption_raw_materials
          ? `${item.consumption_raw_materials.code} · ${item.consumption_raw_materials.name}`
          : "—",
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: Item) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: Item) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}>
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
          title="Items"
          description="Manage inventory and purchase items"
          icon={Database}
          iconColor="bg-indigo-500/10 text-indigo-500"
          action={{
            label: "Add Item",
            onClick: () => {
              resetForm();
              setDialogOpen(true);
            },
            icon: Plus,
          }}
        />

        <DataTable
          columns={columns}
          data={items}
          emptyMessage={isLoading ? "Loading..." : "No items found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedItem ? "Edit Item" : "Add Item"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  rows={2}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) =>
                      setFormData({ ...formData, category: value as PurchaseCategory })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom_id">Unit of Measure</Label>
                  <Select
                    value={formData.uom_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, uom_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {uoms.map((uom) => (
                        <SelectItem key={uom.id} value={uom.id}>
                          {uom.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {formData.category === "raw_material" && (
                <div className="space-y-2">
                  <Label htmlFor="consumption_raw_material_id">
                    Linked Raw Material (production side)
                  </Label>
                  <Select
                    value={formData.consumption_raw_material_id || "none"}
                    onValueChange={(value) =>
                      setFormData({
                        ...formData,
                        consumption_raw_material_id: value === "none" ? "" : value,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="None (procurement-only item)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None (procurement-only item)</SelectItem>
                      {(availableRawMaterials as any[]).map((rm) => (
                        <SelectItem key={rm.id} value={rm.id}>
                          {rm.code} · {rm.name} ({rm.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Links this procurement item to a row in the Consumption Raw Materials
                    master so GRN receipts and stock-closing for the same physical
                    material stay in sync.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="unit_price">Unit Price (Rs.)</Label>
                  <Input
                    id="unit_price"
                    type="number"
                    value={formData.unit_price}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        unit_price: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reorder_level">Reorder Level</Label>
                  <Input
                    id="reorder_level"
                    type="number"
                    value={formData.reorder_level}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        reorder_level: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="min_stock">Min Stock</Label>
                  <Input
                    id="min_stock"
                    type="number"
                    value={formData.min_stock}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        min_stock: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max_stock">Max Stock</Label>
                  <Input
                    id="max_stock"
                    type="number"
                    value={formData.max_stock}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        max_stock: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_inventory_item"
                    checked={formData.is_inventory_item}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_inventory_item: checked })
                    }
                  />
                  <Label htmlFor="is_inventory_item">Inventory Item</Label>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_active: checked })
                    }
                  />
                  <Label htmlFor="is_active">Active</Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Item</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{selectedItem?.name}"? This action
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => selectedItem && deleteMutation.mutate(selectedItem.id)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
