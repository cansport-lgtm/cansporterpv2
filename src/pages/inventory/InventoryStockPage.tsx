import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Package, AlertTriangle, Plus, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Stock {
  id: string;
  item_type: string;
  item_id: string;
  location_id: string | null;
  quantity: number;
  unit_cost: number;
  min_stock: number;
  max_stock: number;
  reorder_level: number;
  last_movement_date: string | null;
}

const ITEM_TYPES = [
  { value: "raw_material", label: "Raw Material" },
  { value: "finished_goods", label: "Finished Goods" },
  { value: "consumable", label: "Consumable" },
];

export default function InventoryStockPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [filterLocation, setFilterLocation] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({
    item_type: "raw_material",
    item_id: "",
    location_id: "",
    quantity: "",
    unit_cost: "",
    min_stock: "",
    max_stock: "",
    reorder_level: "",
  });

  const { data: stockItems = [] } = useQuery({
    queryKey: ["inventory-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_stock")
        .select("*")
        .order("item_type");
      if (error) throw error;
      return data as Stock[];
    },
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (data.id) {
        const { error } = await supabase
          .from("inventory_stock")
          .update({
            quantity: parseFloat(data.quantity),
            unit_cost: parseFloat(data.unit_cost || "0"),
            min_stock: parseFloat(data.min_stock || "0"),
            max_stock: parseFloat(data.max_stock || "0"),
            reorder_level: parseFloat(data.reorder_level || "0"),
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory_stock").insert({
          item_type: data.item_type,
          item_id: data.item_id,
          location_id: data.location_id || null,
          quantity: parseFloat(data.quantity),
          unit_cost: parseFloat(data.unit_cost || "0"),
          min_stock: parseFloat(data.min_stock || "0"),
          max_stock: parseFloat(data.max_stock || "0"),
          reorder_level: parseFloat(data.reorder_level || "0"),
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-stock"] });
      toast.success(selectedStock ? "Stock updated" : "Stock entry created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      item_type: "raw_material",
      item_id: "",
      location_id: "",
      quantity: "",
      unit_cost: "",
      min_stock: "",
      max_stock: "",
      reorder_level: "",
    });
    setSelectedStock(null);
    setDialogOpen(false);
  };

  const handleEdit = (stock: Stock) => {
    setSelectedStock(stock);
    setFormData({
      item_type: stock.item_type,
      item_id: stock.item_id,
      location_id: stock.location_id || "",
      quantity: stock.quantity.toString(),
      unit_cost: stock.unit_cost.toString(),
      min_stock: stock.min_stock.toString(),
      max_stock: stock.max_stock.toString(),
      reorder_level: stock.reorder_level.toString(),
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.item_id) {
      toast.error("Item is required");
      return;
    }
    saveMutation.mutate(
      selectedStock ? { ...formData, id: selectedStock.id } : formData
    );
  };

  const getItemName = (stock: Stock) => {
    if (stock.item_type === "finished_goods") {
      const product = products.find((p: any) => p.id === stock.item_id);
      return product?.name || stock.item_id;
    }
    const item = items.find((i: any) => i.id === stock.item_id);
    return item?.name || stock.item_id;
  };

  const getLocationName = (locationId: string | null) => {
    if (!locationId) return "Unassigned";
    const location = locations.find((l: any) => l.id === locationId);
    return location?.name || locationId;
  };

  // Filter stock items
  const filteredStock = stockItems.filter((stock) => {
    const itemName = getItemName(stock).toLowerCase();
    const matchesSearch = itemName.includes(searchTerm.toLowerCase());
    const matchesType = filterType === "all" || stock.item_type === filterType;
    const matchesLocation =
      filterLocation === "all" || stock.location_id === filterLocation;
    return matchesSearch && matchesType && matchesLocation;
  });

  // Get low stock items
  const lowStockItems = stockItems.filter(
    (s) => s.quantity <= s.reorder_level && s.reorder_level > 0
  );

  // Get available items based on selected item type
  const availableItems =
    formData.item_type === "finished_goods" ? products : items;

  const getStockStatus = (row: Stock): string => {
    if (row.quantity <= row.reorder_level && row.reorder_level > 0) {
      return "rejected";
    }
    if (row.quantity >= row.max_stock && row.max_stock > 0) {
      return "approved";
    }
    return "in_progress";
  };

  const columns = [
    {
      key: "item_type",
      header: "Type",
      render: (item: Stock) =>
        ITEM_TYPES.find((t) => t.value === item.item_type)?.label || item.item_type,
    },
    {
      key: "item_id",
      header: "Item",
      render: (row: Stock) => getItemName(row),
    },
    {
      key: "location_id",
      header: "Location",
      render: (item: Stock) => getLocationName(item.location_id),
    },
    {
      key: "quantity",
      header: "Quantity",
      render: (row: Stock) => (
        <span
          className={
            row.quantity <= row.reorder_level && row.reorder_level > 0
              ? "text-destructive font-semibold"
              : ""
          }
        >
          {row.quantity.toLocaleString()}
        </span>
      ),
    },
    {
      key: "unit_cost",
      header: "Unit Cost",
      render: (item: Stock) => `₹${item.unit_cost.toFixed(2)}`,
    },
    {
      key: "value",
      header: "Value",
      render: (row: Stock) =>
        `₹${(row.quantity * row.unit_cost).toLocaleString()}`,
    },
    {
      key: "reorder_level",
      header: "Reorder At",
      render: (item: Stock) => item.reorder_level.toLocaleString(),
    },
    {
      key: "status",
      header: "Status",
      render: (row: Stock) => <StatusBadge status={getStockStatus(row)} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: Stock) => (
        <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Inventory Stock"
        description="View and manage current stock levels across all locations"
        icon={Package}
        action={{
          label: "Add Stock Entry",
          onClick: () => setDialogOpen(true),
          icon: Plus,
        }}
      />

      {/* Low Stock Alert */}
      {lowStockItems.length > 0 && (
        <Card className="mb-6 border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Low Stock Alert ({lowStockItems.length} items)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {lowStockItems.slice(0, 5).map((item) => (
                <span
                  key={item.id}
                  className="px-2 py-1 bg-destructive/10 text-destructive text-sm rounded"
                >
                  {getItemName(item)} ({item.quantity} left)
                </span>
              ))}
              {lowStockItems.length > 5 && (
                <span className="px-2 py-1 text-sm text-muted-foreground">
                  +{lowStockItems.length - 5} more
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4 mb-6">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Search items..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {ITEM_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterLocation} onValueChange={setFilterLocation}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by location" />
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

      <DataTable columns={columns} data={filteredStock} />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedStock ? "Edit Stock Entry" : "Add Stock Entry"}
            </DialogTitle>
            <DialogDescription>
              {selectedStock
                ? "Update stock levels and settings"
                : "Add a new stock entry for an item"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {!selectedStock && (
              <>
                <div className="space-y-2">
                  <Label>Item Type *</Label>
                  <Select
                    value={formData.item_type}
                    onValueChange={(value) =>
                      setFormData({ ...formData, item_type: value, item_id: "" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ITEM_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Item *</Label>
                  <Select
                    value={formData.item_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, item_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select item" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableItems.map((item: any) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name} ({item.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Location</Label>
                  <Select
                    value={formData.location_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, location_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select location" />
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
              </>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) =>
                    setFormData({ ...formData, quantity: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Unit Cost</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.unit_cost}
                  onChange={(e) =>
                    setFormData({ ...formData, unit_cost: e.target.value })
                  }
                  placeholder="0.00"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Min Stock</Label>
                <Input
                  type="number"
                  value={formData.min_stock}
                  onChange={(e) =>
                    setFormData({ ...formData, min_stock: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Max Stock</Label>
                <Input
                  type="number"
                  value={formData.max_stock}
                  onChange={(e) =>
                    setFormData({ ...formData, max_stock: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <Label>Reorder Level</Label>
                <Input
                  type="number"
                  value={formData.reorder_level}
                  onChange={(e) =>
                    setFormData({ ...formData, reorder_level: e.target.value })
                  }
                  placeholder="0"
                />
              </div>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                {selectedStock ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
