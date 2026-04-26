import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MapPin, Plus, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { toast } from "sonner";

interface Location {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export default function FloorInventoryLocationsPage() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    code: "",
    description: "",
    is_active: true,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ["floor-inventory-locations-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("floor_inventory_locations")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as Location[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingLocation) {
        const { error } = await supabase
          .from("floor_inventory_locations")
          .update({
            name: data.name,
            code: data.code || null,
            description: data.description || null,
            is_active: data.is_active,
          })
          .eq("id", editingLocation.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("floor_inventory_locations").insert({
          name: data.name,
          code: data.code || null,
          description: data.description || null,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["floor-inventory-locations-all"] });
      toast.success(editingLocation ? "Location updated" : "Location created");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save location");
    },
  });

  const resetForm = () => {
    setFormData({
      name: "",
      code: "",
      description: "",
      is_active: true,
    });
    setEditingLocation(null);
    setIsDialogOpen(false);
  };

  const handleEdit = (location: Location) => {
    setEditingLocation(location);
    setFormData({
      name: location.name,
      code: location.code || "",
      description: location.description || "",
      is_active: location.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.name) {
      toast.error("Please enter a location name");
      return;
    }
    saveMutation.mutate(formData);
  };

  const columns = [
    {
      key: "name",
      header: "Location Name",
      render: (item: Location) => <span className="font-medium">{item.name}</span>,
    },
    {
      key: "code",
      header: "Code",
      render: (item: Location) => item.code || "-",
    },
    {
      key: "description",
      header: "Description",
      render: (item: Location) => item.description || "-",
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: Location) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          item.is_active
            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
            : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
        }`}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "created_at",
      header: "Created",
      render: (item: Location) => format(new Date(item.created_at), "dd MMM yyyy"),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: Location) => (
        <Button variant="ghost" size="sm" onClick={() => handleEdit(item)}>
          <Pencil className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Floor Locations"
        description="Manage floor inventory locations"
        icon={MapPin}
        action={{
          label: "Add Location",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        }}
      />

      <DataTable columns={columns} data={locations} />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingLocation ? "Edit Location" : "Add New Location"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Location Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Production Floor A"
              />
            </div>
            <div className="space-y-2">
              <Label>Code</Label>
              <Input
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g., PFA"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Location description..."
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
              />
              <Label>Active</Label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={resetForm}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {editingLocation ? "Update" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ERPLayout>
  );
}
