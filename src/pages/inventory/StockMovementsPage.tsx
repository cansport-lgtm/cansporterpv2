import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowRightLeft, Plus, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";

interface Movement {
  id: string;
  movement_number: string;
  movement_type: string;
  movement_date: string;
  item_type: string;
  item_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: number;
  unit_cost: number;
  reference_type: string | null;
  reference_number: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
}

const MOVEMENT_TYPES = [
  { value: "receipt", label: "Receipt (In)" },
  { value: "issue", label: "Issue (Out)" },
  { value: "transfer", label: "Transfer" },
  { value: "adjustment", label: "Adjustment" },
];

const ITEM_TYPES = [
  { value: "raw_material", label: "Raw Material" },
  { value: "finished_goods", label: "Finished Goods" },
  { value: "consumable", label: "Consumable" },
];

export default function StockMovementsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null);
  const [formData, setFormData] = useState({
    movement_type: "receipt",
    movement_date: format(new Date(), "yyyy-MM-dd"),
    item_type: "raw_material",
    item_id: "",
    from_location_id: "",
    to_location_id: "",
    quantity: "",
    unit_cost: "",
    reference_type: "",
    reference_number: "",
    remarks: "",
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["stock-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_movements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Movement[];
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
      const { error } = await supabase.from("stock_movements").insert({
        ...data,
        quantity: parseFloat(data.quantity),
        unit_cost: parseFloat(data.unit_cost || "0"),
        from_location_id: data.from_location_id || null,
        to_location_id: data.to_location_id || null,
        created_by: user?.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stock-movements"] });
      toast.success("Stock movement recorded");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      movement_type: "receipt",
      movement_date: format(new Date(), "yyyy-MM-dd"),
      item_type: "raw_material",
      item_id: "",
      from_location_id: "",
      to_location_id: "",
      quantity: "",
      unit_cost: "",
      reference_type: "",
      reference_number: "",
      remarks: "",
    });
    setDialogOpen(false);
  };

  const handleSubmit = () => {
    if (!formData.item_id || !formData.quantity) {
      toast.error("Item and quantity are required");
      return;
    }
    saveMutation.mutate(formData);
  };

  const getItemName = (movement: Movement) => {
    if (movement.item_type === "finished_goods") {
      const product = products.find((p: any) => p.id === movement.item_id);
      return product?.name || movement.item_id;
    }
    const item = items.find((i: any) => i.id === movement.item_id);
    return item?.name || movement.item_id;
  };

  const getLocationName = (locationId: string | null) => {
    if (!locationId) return "-";
    const location = locations.find((l: any) => l.id === locationId);
    return location?.name || locationId;
  };

  const columns = [
    { key: "movement_number", header: "Movement #" },
    {
      key: "movement_date",
      header: "Date",
      render: (item: Movement) => format(new Date(item.movement_date), "dd MMM yyyy"),
    },
    {
      key: "movement_type",
      header: "Type",
      render: (item: Movement) => {
        const type = item.movement_type;
        const status = type === "receipt" || type === "production_out"
          ? "approved"
          : type === "issue" || type === "production_in"
          ? "pending"
          : "in_progress";
        return <StatusBadge status={status} />;
      },
    },
    {
      key: "item_type",
      header: "Item Type",
      render: (item: Movement) =>
        ITEM_TYPES.find((t) => t.value === item.item_type)?.label || item.item_type,
    },
    {
      key: "item_id",
      header: "Item",
      render: (row: Movement) => getItemName(row),
    },
    {
      key: "quantity",
      header: "Quantity",
      render: (item: Movement) => item.quantity.toLocaleString(),
    },
    {
      key: "from_location_id",
      header: "From",
      render: (item: Movement) => getLocationName(item.from_location_id),
    },
    {
      key: "to_location_id",
      header: "To",
      render: (item: Movement) => getLocationName(item.to_location_id),
    },
    { key: "reference_number", header: "Reference" },
    {
      key: "actions",
      header: "Actions",
      render: (row: Movement) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setSelectedMovement(row);
            setViewDialogOpen(true);
          }}
        >
          <Eye className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  // Get available items based on selected item type
  const availableItems =
    formData.item_type === "finished_goods" ? products : items;

  return (
    <ERPLayout>
      <PageHeader
        title="Stock Movements"
        description="Track all inventory movements - receipts, issues, transfers"
        icon={ArrowRightLeft}
        action={{
          label: "New Movement",
          onClick: () => setDialogOpen(true),
          icon: Plus,
        }}
      />

      <DataTable columns={columns} data={movements} />

      {/* New Movement Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Record Stock Movement</DialogTitle>
            <DialogDescription>
              Record a new inventory movement transaction
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Movement Type *</Label>
                <Select
                  value={formData.movement_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, movement_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOVEMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Date *</Label>
                <Input
                  type="date"
                  value={formData.movement_date}
                  onChange={(e) =>
                    setFormData({ ...formData, movement_date: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  From Location{" "}
                  {formData.movement_type !== "receipt" && "*"}
                </Label>
                <Select
                  value={formData.from_location_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, from_location_id: value })
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
              <div className="space-y-2">
                <Label>
                  To Location {formData.movement_type !== "issue" && "*"}
                </Label>
                <Select
                  value={formData.to_location_id}
                  onValueChange={(value) =>
                    setFormData({ ...formData, to_location_id: value })
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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity *</Label>
                <Input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) =>
                    setFormData({ ...formData, quantity: e.target.value })
                  }
                  placeholder="Enter quantity"
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reference Type</Label>
                <Select
                  value={formData.reference_type}
                  onValueChange={(value) =>
                    setFormData({ ...formData, reference_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="internal">Internal Movement</SelectItem>
                    <SelectItem value="adjustment">Stock Adjustment</SelectItem>
                    <SelectItem value="manual">Manual Entry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reference Number</Label>
                <Input
                  value={formData.reference_number}
                  onChange={(e) =>
                    setFormData({ ...formData, reference_number: e.target.value })
                  }
                  placeholder="e.g., GRN-00001"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) =>
                  setFormData({ ...formData, remarks: e.target.value })
                }
                placeholder="Optional notes"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                Record Movement
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Movement Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Movement Details</DialogTitle>
            <DialogDescription>
              {selectedMovement?.movement_number}
            </DialogDescription>
          </DialogHeader>
          {selectedMovement && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Type:</span>{" "}
                  {MOVEMENT_TYPES.find(
                    (t) => t.value === selectedMovement.movement_type
                  )?.label}
                </div>
                <div>
                  <span className="text-muted-foreground">Date:</span>{" "}
                  {format(new Date(selectedMovement.movement_date), "dd MMM yyyy")}
                </div>
                <div>
                  <span className="text-muted-foreground">Item:</span>{" "}
                  {getItemName(selectedMovement)}
                </div>
                <div>
                  <span className="text-muted-foreground">Quantity:</span>{" "}
                  {selectedMovement.quantity.toLocaleString()}
                </div>
                <div>
                  <span className="text-muted-foreground">From:</span>{" "}
                  {getLocationName(selectedMovement.from_location_id)}
                </div>
                <div>
                  <span className="text-muted-foreground">To:</span>{" "}
                  {getLocationName(selectedMovement.to_location_id)}
                </div>
                {selectedMovement.reference_number && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Reference:</span>{" "}
                    {selectedMovement.reference_number}
                  </div>
                )}
                {selectedMovement.remarks && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Remarks:</span>{" "}
                    {selectedMovement.remarks}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
