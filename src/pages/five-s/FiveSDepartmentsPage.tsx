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

interface FiveSDepartment {
  id: string;
  code: string;
  name: string;
  sequence_order: number | null;
  is_active: boolean | null;
}

export default function FiveSDepartmentsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<FiveSDepartment | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    sequence_order: 0,
    is_active: true,
  });

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["five_s_departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("five_s_departments")
        .select("*")
        .order("sequence_order", { ascending: true });
      if (error) throw error;
      return data as FiveSDepartment[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("five_s_departments")
          .update({
            code: data.code,
            name: data.name,
            sequence_order: data.sequence_order,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("five_s_departments")
          .insert({
            code: data.code,
            name: data.name,
            sequence_order: data.sequence_order,
            is_active: data.is_active,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["five_s_departments"] });
      toast.success(selectedItem ? "Department updated" : "Department created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("five_s_departments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["five_s_departments"] });
      toast.success("Department deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({ code: "", name: "", sequence_order: 0, is_active: true });
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: FiveSDepartment) => {
    setSelectedItem(item);
    setFormData({
      code: item.code,
      name: item.name,
      sequence_order: item.sequence_order || 0,
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: FiveSDepartment) => {
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
    { key: "sequence_order", header: "Order" },
    {
      key: "is_active",
      header: "Status",
      render: (item: FiveSDepartment) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: FiveSDepartment) => (
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
          title="5S Departments"
          description="Manage departments for 5S audits"
          icon={Database}
          iconColor="bg-sky-500/10 text-sky-500"
          action={{
            label: "Add Department",
            onClick: () => {
              resetForm();
              setDialogOpen(true);
            },
            icon: Plus,
          }}
        />

        <DataTable
          columns={columns}
          data={departments}
          emptyMessage={isLoading ? "Loading..." : "No departments found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedItem ? "Edit Department" : "Add Department"}
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
                <Label htmlFor="sequence_order">Sequence Order</Label>
                <Input
                  id="sequence_order"
                  type="number"
                  value={formData.sequence_order}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      sequence_order: parseInt(e.target.value) || 0,
                    })
                  }
                />
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
              <AlertDialogTitle>Delete Department</AlertDialogTitle>
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
