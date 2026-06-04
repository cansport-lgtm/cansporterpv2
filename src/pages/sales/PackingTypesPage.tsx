import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Package, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

interface PackingType {
  id: string;
  label: string;
  dozens: number;
  is_active: boolean;
  sort_order: number;
}

export default function PackingTypesPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission } = useAuth();
  const canEdit = hasModulePermission("sales", "edit");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PackingType | null>(null);
  const [formData, setFormData] = useState({
    label: "",
    dozens: "",
    sort_order: "",
    is_active: true,
  });

  const { data: packings = [], isLoading } = useQuery({
    queryKey: ["packing-types-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packing_types")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return data as PackingType[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      const payload = {
        label: data.label.trim(),
        dozens: parseFloat(data.dozens) || 0,
        sort_order: parseInt(data.sort_order) || 0,
        is_active: data.is_active,
      };
      if (data.id) {
        const { error } = await supabase.from("packing_types").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("packing_types").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packing-types-all"] });
      queryClient.invalidateQueries({ queryKey: ["packing-types"] });
      toast.success(selectedItem ? "Packing type updated" : "Packing type created");
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("packing_types").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["packing-types-all"] });
      queryClient.invalidateQueries({ queryKey: ["packing-types"] });
      toast.success("Packing type deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetForm = () => {
    setFormData({ label: "", dozens: "", sort_order: "", is_active: true });
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: PackingType) => {
    setSelectedItem(item);
    setFormData({
      label: item.label,
      dozens: String(item.dozens ?? ""),
      sort_order: String(item.sort_order ?? ""),
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: PackingType) => {
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  const columns = [
    { key: "label", header: "Packing" },
    {
      key: "dozens",
      header: "Dozens / Package",
      render: (item: PackingType) => <span>{Number(item.dozens).toLocaleString()}</span>,
    },
    { key: "sort_order", header: "Order" },
    {
      key: "is_active",
      header: "Status",
      render: (item: PackingType) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: PackingType) =>
        canEdit ? (
          <div className="flex gap-2">
            <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => handleDelete(item)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Packing Master"
          description="Define packing types and their dozens per package (used by sales orders & dispatch)"
          icon={Package}
          iconColor="bg-orange-500/10 text-orange-500"
          action={
            canEdit
              ? {
                  label: "Add Packing",
                  onClick: () => {
                    resetForm();
                    setDialogOpen(true);
                  },
                  icon: Plus,
                }
              : undefined
          }
        />

        <DataTable
          columns={columns}
          data={packings}
          emptyMessage={isLoading ? "Loading..." : "No packing types found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedItem ? "Edit Packing" : "Add Packing"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="label">Packing label</Label>
                <Input
                  id="label"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g. 30 Dz Bag"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="dozens">Dozens / package</Label>
                  <Input
                    id="dozens"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.dozens}
                    onChange={(e) => setFormData({ ...formData, dozens: e.target.value })}
                    placeholder="e.g. 30"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sort_order">Sort order</Label>
                  <Input
                    id="sort_order"
                    type="number"
                    value={formData.sort_order}
                    onChange={(e) => setFormData({ ...formData, sort_order: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label htmlFor="is_active">Active</Label>
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
              <AlertDialogTitle>Delete Packing</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{selectedItem?.label}"? Existing orders keep their
                stored packing text; only future selections are affected.
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
