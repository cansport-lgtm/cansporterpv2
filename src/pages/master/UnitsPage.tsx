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

interface UOM {
  id: string;
  symbol: string;
  name: string;
  is_active: boolean | null;
}

export default function UnitsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<UOM | null>(null);
  const [formData, setFormData] = useState({
    symbol: "",
    name: "",
    is_active: true,
  });

  const { data: uoms = [], isLoading } = useQuery({
    queryKey: ["units_of_measure"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units_of_measure")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as UOM[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("units_of_measure")
          .update({
            symbol: data.symbol,
            name: data.name,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("units_of_measure").insert({
          symbol: data.symbol,
          name: data.name,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units_of_measure"] });
      toast.success(selectedItem ? "Unit updated" : "Unit created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("units_of_measure").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units_of_measure"] });
      toast.success("Unit deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({ symbol: "", name: "", is_active: true });
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: UOM) => {
    setSelectedItem(item);
    setFormData({
      symbol: item.symbol,
      name: item.name,
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: UOM) => {
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  const columns = [
    { key: "symbol", header: "Symbol" },
    { key: "name", header: "Name" },
    {
      key: "is_active",
      header: "Status",
      render: (item: UOM) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: UOM) => (
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
          title="Units of Measure"
          description="Manage units of measure (UOM)"
          icon={Database}
          iconColor="bg-cyan-500/10 text-cyan-500"
          action={{
            label: "Add Unit",
            onClick: () => {
              resetForm();
              setDialogOpen(true);
            },
            icon: Plus,
          }}
        />

        <DataTable
          columns={columns}
          data={uoms}
          emptyMessage={isLoading ? "Loading..." : "No units found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedItem ? "Edit Unit" : "Add Unit"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="symbol">Symbol</Label>
                  <Input
                    id="symbol"
                    value={formData.symbol}
                    onChange={(e) =>
                      setFormData({ ...formData, symbol: e.target.value })
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
              <AlertDialogTitle>Delete Unit</AlertDialogTitle>
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
