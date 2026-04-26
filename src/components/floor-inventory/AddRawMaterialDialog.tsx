import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ITEM_UNITS = [
  { value: "bags", label: "Bags" },
  { value: "sheets", label: "Sheets" },
  { value: "kg", label: "Kg" },
  { value: "litre", label: "Litre" },
];

interface AddRawMaterialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRawMaterialDialog({ open, onOpenChange }: AddRawMaterialDialogProps) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    item_code: "",
    item_name: "",
    unit: "bags",
    production_floor: "",
    quantity: 0,
  });

  // Fetch locations for storage floor dropdown
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

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Insert stock record
      const { data: stockData, error: stockError } = await supabase
        .from("floor_inventory_stock")
        .insert({
          item_name: data.item_name,
          item_code: data.item_code || null,
          category: "raw_material",
          unit: data.unit,
          production_floor: data.production_floor || null,
          quantity: data.quantity,
        })
        .select()
        .single();
      if (stockError) throw stockError;

      // If quantity > 0, create opening balance movement to populate ledger
      if (data.quantity > 0) {
        const { error: movementError } = await supabase
          .from("floor_inventory_movements")
          .insert({
            item_name: data.item_name,
            movement_type: "receipt",
            quantity: data.quantity,
            unit: data.unit,
            to_location_id: data.production_floor || null,
            reference_type: "internal",
            remarks: "Opening Balance",
            status: "completed",
          });
        if (movementError) throw movementError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-items"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-stock"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-movements"] });
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-ledger"] });
      toast.success("Raw material added successfully");
      resetForm();
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add raw material");
    },
  });

  const resetForm = () => {
    setFormData({
      item_code: "",
      item_name: "",
      unit: "bags",
      production_floor: "",
      quantity: 0,
    });
  };

  const handleSubmit = () => {
    if (!formData.item_name) {
      toast.error("Item name is required");
      return;
    }
    saveMutation.mutate(formData);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Raw Material</DialogTitle>
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
            <div className="space-y-2">
              <Label>Storage Floor</Label>
              <Select
                value={formData.production_floor || "__none__"}
                onValueChange={(v) => setFormData({ ...formData, production_floor: v === "__none__" ? "" : v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select storage floor" />
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
            <Label>Opening Quantity</Label>
            <Input
              type="number"
              min="0"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: parseFloat(e.target.value) || 0 })}
              placeholder="Enter opening quantity"
            />
            <p className="text-xs text-muted-foreground">
              This will create an opening balance entry in the ledger
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Adding..." : "Add Raw Material"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
