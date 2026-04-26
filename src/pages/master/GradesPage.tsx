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

interface Grade {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean | null;
}

export default function GradesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Grade | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    is_active: true,
  });

  const { data: grades = [], isLoading } = useQuery({
    queryKey: ["grades"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as Grade[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("grades")
          .update({
            code: data.code,
            name: data.name,
            description: data.description || null,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("grades").insert({
          code: data.code,
          name: data.name,
          description: data.description || null,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      toast.success(selectedItem ? "Grade updated" : "Grade created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("grades").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      toast.success("Grade deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({ code: "", name: "", description: "", is_active: true });
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: Grade) => {
    setSelectedItem(item);
    setFormData({
      code: item.code,
      name: item.name,
      description: item.description || "",
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: Grade) => {
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
    { key: "description", header: "Description" },
    {
      key: "is_active",
      header: "Status",
      render: (item: Grade) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: Grade) => (
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
          title="Grades"
          description="Manage product grades"
          icon={Database}
          iconColor="bg-green-500/10 text-green-500"
          action={{
            label: "Add Grade",
            onClick: () => {
              resetForm();
              setDialogOpen(true);
            },
            icon: Plus,
          }}
        />

        <DataTable
          columns={columns}
          data={grades}
          emptyMessage={isLoading ? "Loading..." : "No grades found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {selectedItem ? "Edit Grade" : "Add Grade"}
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
              <AlertDialogTitle>Delete Grade</AlertDialogTitle>
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
