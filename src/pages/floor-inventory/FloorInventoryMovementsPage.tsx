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
import { ArrowUpDown, Plus, Eye, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";

interface Movement {
  id: string;
  movement_number: string;
  movement_date: string;
  movement_type: string;
  item_name: string;
  from_location_id: string | null;
  to_location_id: string | null;
  quantity: number;
  unit: string | null;
  reference_type: string | null;
  reference_number: string | null;
  remarks: string | null;
  status: string;
  created_at: string;
}

const MOVEMENT_TYPES_BASE = [
  { value: "receipt", label: "Receipt" },
  { value: "issue", label: "Issue" },
  { value: "transfer", label: "Transfer" },
];

const MOVEMENT_TYPE_ADJUSTMENT = { value: "adjustment", label: "Adjustment" };

const REFERENCE_TYPES = [
  { value: "internal", label: "Internal Movement" },
  { value: "adjustment", label: "Stock Adjustment" },
  { value: "manual", label: "Manual Entry" },
];

export default function FloorInventoryMovementsPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedMovement, setSelectedMovement] = useState<Movement | null>(null);
  const [movementToDelete, setMovementToDelete] = useState<Movement | null>(null);
  const [formData, setFormData] = useState({
    movement_date: format(new Date(), "yyyy-MM-dd"),
    movement_type: "receipt",
    item_name: "",
    from_location_id: "",
    to_location_id: "",
    quantity: "",
    unit: "pcs",
    reference_type: "internal",
    reference_number: "",
    remarks: "",
  });

  const { data: movements = [] } = useQuery({
    queryKey: ["floor-inventory-movements"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_movements")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Movement[];
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

  const { data: stockItems = [] } = useQuery({
    queryKey: ["floor-inventory-stock-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_stock")
        .select("id, item_code, item_name, unit")
        .order("item_name");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase.from("floor_inventory_movements").insert({
        movement_date: data.movement_date,
        movement_type: data.movement_type,
        item_name: data.item_name,
        from_location_id: data.from_location_id || null,
        to_location_id: data.to_location_id || null,
        quantity: Number(data.quantity),
        unit: data.unit,
        reference_type: data.reference_type || null,
        reference_number: data.reference_number || null,
        remarks: data.remarks || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      toast.success("Movement recorded successfully");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save movement");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("floor_inventory_movements")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-ledger"] });
      toast.success("Movement deleted successfully");
      setMovementToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete movement");
    },
  });

  const resetForm = () => {
    setFormData({
      movement_date: format(new Date(), "yyyy-MM-dd"),
      movement_type: "receipt",
      item_name: "",
      from_location_id: "",
      to_location_id: "",
      quantity: "",
      unit: "pcs",
      reference_type: "internal",
      reference_number: "",
      remarks: "",
    });
    setIsAddOpen(false);
  };

  const handleSubmit = () => {
    if (!formData.item_name || !formData.quantity) {
      toast.error("Please fill required fields");
      return;
    }
    saveMutation.mutate(formData);
  };

  const getLocationName = (locationId: string | null) => {
    if (!locationId) return "-";
    const location = locations.find((l: any) => l.id === locationId);
    return location?.name || "-";
  };

  const columns = [
    {
      key: "movement_number",
      header: "Movement #",
      render: (item: Movement) => (
        <span className="font-medium">{item.movement_number}</span>
      ),
    },
    {
      key: "movement_date",
      header: "Date",
      render: (item: Movement) => format(new Date(item.movement_date), "dd MMM yyyy"),
    },
    {
      key: "movement_type",
      header: "Type",
      render: (item: Movement) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
          item.movement_type === "receipt"
            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
            : item.movement_type === "issue"
            ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
            : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
        }`}>
          {item.movement_type}
        </span>
      ),
    },
    {
      key: "item_name",
      header: "Item",
    },
    {
      key: "from_location",
      header: "From Location",
      render: (item: Movement) => getLocationName(item.from_location_id),
    },
    {
      key: "to_location",
      header: "To Location",
      render: (item: Movement) => getLocationName(item.to_location_id),
    },
    {
      key: "quantity",
      header: "Quantity",
      render: (item: Movement) => (
        <span className={`font-medium ${
          item.movement_type === "receipt" ? "text-primary" : 
          item.movement_type === "issue" ? "text-destructive" : ""
        }`}>
          {item.movement_type === "receipt" ? "+" : item.movement_type === "issue" ? "-" : ""}
          {item.quantity} {item.unit || "pcs"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (item: Movement) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
          item.status === "completed"
            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
        }`}>
          {item.status}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: Movement) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedMovement(item)}
          >
            <Eye className="h-4 w-4" />
          </Button>
          {isSuperAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMovementToDelete(item)}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Floor Inventory Movements"
        description="Track stock movements on the production floor"
        icon={ArrowUpDown}
        action={{
          label: "New Movement",
          onClick: () => setIsAddOpen(true),
          icon: Plus,
        }}
      />

      <DataTable columns={columns} data={movements} />

      {/* Add Movement Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record New Movement</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Date</Label>
                <Input
                  type="date"
                  value={formData.movement_date}
                  onChange={(e) => setFormData({ ...formData, movement_date: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Movement Type</Label>
                <Select
                  value={formData.movement_type}
                  onValueChange={(v) => setFormData({ ...formData, movement_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MOVEMENT_TYPES_BASE.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                    {isSuperAdmin && (
                      <SelectItem value={MOVEMENT_TYPE_ADJUSTMENT.value}>
                        {MOVEMENT_TYPE_ADJUSTMENT.label}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Item Name *</Label>
              <Select
                value={formData.item_name}
                onValueChange={(v) => {
                  const selectedItem = stockItems.find((item: any) => item.item_name === v);
                  setFormData({ 
                    ...formData, 
                    item_name: v,
                    unit: selectedItem?.unit || formData.unit
                  });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select item" />
                </SelectTrigger>
                <SelectContent>
                  {stockItems.map((item: any) => (
                    <SelectItem key={item.id} value={item.item_name}>
                      {item.item_code ? `${item.item_code} - ${item.item_name}` : item.item_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>From Location</Label>
                <Select
                  value={formData.from_location_id || "none"}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      from_location_id: v === "none" ? "" : v,
                    })
                  }
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
              <div className="space-y-2">
                <Label>To Location</Label>
                <Select
                  value={formData.to_location_id || "none"}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      to_location_id: v === "none" ? "" : v,
                    })
                  }
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
                <Input
                  value={formData.unit}
                  onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                  placeholder="pcs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Reference Type</Label>
                <Select
                  value={formData.reference_type}
                  onValueChange={(v) => setFormData({ ...formData, reference_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REFERENCE_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reference Number</Label>
                <Input
                  value={formData.reference_number}
                  onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                  placeholder="Optional"
                />
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
              Save Movement
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* View Movement Dialog */}
      <Dialog open={!!selectedMovement} onOpenChange={() => setSelectedMovement(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Movement Details</DialogTitle>
          </DialogHeader>
          {selectedMovement && (
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Movement #</p>
                  <p className="font-medium">{selectedMovement.movement_number}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Date</p>
                  <p className="font-medium">{format(new Date(selectedMovement.movement_date), "dd MMM yyyy")}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Type</p>
                  <p className="font-medium capitalize">{selectedMovement.movement_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{selectedMovement.status}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Item</p>
                  <p className="font-medium">{selectedMovement.item_name}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">From Location</p>
                  <p className="font-medium">{getLocationName(selectedMovement.from_location_id)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">To Location</p>
                  <p className="font-medium">{getLocationName(selectedMovement.to_location_id)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Quantity</p>
                  <p className="font-medium">{selectedMovement.quantity} {selectedMovement.unit}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Reference</p>
                  <p className="font-medium">{selectedMovement.reference_number || "-"}</p>
                </div>
                {selectedMovement.remarks && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Remarks</p>
                    <p className="font-medium">{selectedMovement.remarks}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!movementToDelete} onOpenChange={() => setMovementToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Movement</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete movement <strong>{movementToDelete?.movement_number}</strong>? 
              This will reverse the stock and ledger entries. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => movementToDelete && deleteMutation.mutate(movementToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
