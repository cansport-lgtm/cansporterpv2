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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Warehouse, Plus, Pencil, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Location {
  id: string;
  code: string;
  name: string;
  location_type: string;
  description: string | null;
  is_active: boolean | null;
}

const LOCATION_TYPES = [
  { value: "warehouse", label: "Warehouse" },
  { value: "store", label: "Store" },
  { value: "production_floor", label: "Production Floor" },
  { value: "wip", label: "Work In Progress" },
];

export default function InventoryLocationsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    location_type: "warehouse",
    description: "",
    is_active: true,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["inventory-locations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_locations")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as Location[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("inventory_locations")
          .update(data)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("inventory_locations").insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-locations"] });
      toast.success(selectedLocation ? "Location updated" : "Location created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("inventory_locations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["inventory-locations"] });
      toast.success("Location deleted");
      setDeleteDialogOpen(false);
      setSelectedLocation(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      location_type: "warehouse",
      description: "",
      is_active: true,
    });
    setSelectedLocation(null);
    setDialogOpen(false);
  };

  const handleEdit = (location: Location) => {
    setSelectedLocation(location);
    setFormData({
      code: location.code,
      name: location.name,
      location_type: location.location_type,
      description: location.description || "",
      is_active: location.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.code || !formData.name) {
      toast.error("Code and Name are required");
      return;
    }
    saveMutation.mutate(
      selectedLocation ? { ...formData, id: selectedLocation.id } : formData
    );
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    {
      key: "location_type",
      header: "Type",
      render: (item: Location) =>
        LOCATION_TYPES.find((t) => t.value === item.location_type)?.label || item.location_type,
    },
    { key: "description", header: "Description" },
    {
      key: "is_active",
      header: "Status",
      render: (item: Location) => (
        <StatusBadge status={item.is_active ? "approved" : "rejected"} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: Location) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setSelectedLocation(row);
              setDeleteDialogOpen(true);
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
      <PageHeader
        title="Storage Locations"
        description="Manage warehouses, stores, and production areas"
        icon={Warehouse}
        action={{
          label: "Add Location",
          onClick: () => setDialogOpen(true),
          icon: Plus,
        }}
      />

      <DataTable columns={columns} data={locations} />

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedLocation ? "Edit Location" : "Add Location"}
            </DialogTitle>
            <DialogDescription>
              {selectedLocation
                ? "Update location details"
                : "Create a new storage location"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) =>
                    setFormData({ ...formData, code: e.target.value.toUpperCase() })
                  }
                  placeholder="e.g., WH-001"
                />
              </div>
              <div className="space-y-2">
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="Location name"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Location Type</Label>
              <Select
                value={formData.location_type}
                onValueChange={(value) =>
                  setFormData({ ...formData, location_type: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATION_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Optional description"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
              <Label>Active</Label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                {selectedLocation ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{selectedLocation?.name}". This action
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                selectedLocation && deleteMutation.mutate(selectedLocation.id)
              }
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
