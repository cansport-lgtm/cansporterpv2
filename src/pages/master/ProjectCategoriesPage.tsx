import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { FolderKanban, Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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

interface ProjectCategory {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  sequence_order: number;
  is_active: boolean;
}

const emptyForm = { name: "", code: "", description: "", sequence_order: "0", is_active: true };

export default function ProjectCategoriesPage() {
  const queryClient = useQueryClient();
  const { hasModulePermission } = useAuth();
  const canCreate = hasModulePermission("master_data", "create");
  const canEdit = hasModulePermission("master_data", "edit");
  const canDelete = hasModulePermission("master_data", "delete");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ProjectCategory | null>(null);
  const [formData, setFormData] = useState(emptyForm);

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["project_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_categories")
        .select("*")
        .order("sequence_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return data as ProjectCategory[];
    },
  });

  const { data: usage = {} } = useQuery({
    queryKey: ["project_categories_usage"],
    queryFn: async () => {
      const { data, error } = await supabase.from("projects").select("category_id").not("category_id", "is", null);
      if (error) throw error;
      const counts: Record<string, number> = {};
      (data || []).forEach((r) => {
        if (r.category_id) counts[r.category_id] = (counts[r.category_id] || 0) + 1;
      });
      return counts;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      const payload = {
        name: data.name.trim(),
        code: data.code.trim() ? data.code.trim().toUpperCase() : null,
        description: data.description.trim() || null,
        sequence_order: parseInt(data.sequence_order) || 0,
        is_active: data.is_active,
      };
      if (data.id) {
        const { error } = await supabase.from("project_categories").update(payload).eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("project_categories").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_categories"] });
      toast.success(selectedItem ? "Category updated" : "Category created");
      resetForm();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project_categories"] });
      toast.success("Category deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resetForm = () => {
    setFormData(emptyForm);
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: ProjectCategory) => {
    setSelectedItem(item);
    setFormData({
      name: item.name,
      code: item.code || "",
      description: item.description || "",
      sequence_order: String(item.sequence_order ?? 0),
      is_active: item.is_active,
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: ProjectCategory) => {
    if (usage[item.id]) {
      toast.error(`In use by ${usage[item.id]} project(s). Deactivate it instead.`);
      return;
    }
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  const columns = [
    { key: "sequence_order", header: "Order" },
    { key: "code", header: "Code", render: (i: ProjectCategory) => i.code || "-" },
    { key: "name", header: "Name" },
    { key: "description", header: "Description", render: (i: ProjectCategory) => i.description || "-" },
    { key: "projects", header: "Projects", render: (i: ProjectCategory) => usage[i.id] || 0 },
    {
      key: "is_active",
      header: "Status",
      render: (i: ProjectCategory) => (
        <span className={i.is_active ? "text-green-500" : "text-red-500"}>{i.is_active ? "Active" : "Inactive"}</span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (i: ProjectCategory) => (
        <div className="flex gap-2">
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={() => handleEdit(i)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="icon" onClick={() => handleDelete(i)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Project Categories"
          description="Manage categories used to classify projects"
          icon={FolderKanban}
          iconColor="bg-indigo-500/10 text-indigo-500"
          action={canCreate ? { label: "Add Category", onClick: () => { resetForm(); setDialogOpen(true); }, icon: Plus } : undefined}
        />

        <DataTable columns={columns} data={categories} emptyMessage={isLoading ? "Loading..." : "No categories found"} />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selectedItem ? "Edit Category" : "Add Category"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input id="code" value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} maxLength={10} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" rows={2} value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sequence_order">Display Order</Label>
                <Input id="sequence_order" type="number" value={formData.sequence_order} onChange={(e) => setFormData({ ...formData, sequence_order: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="is_active" checked={formData.is_active} onCheckedChange={(c) => setFormData({ ...formData, is_active: c })} />
                <Label htmlFor="is_active">Active</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
                <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving..." : "Save"}</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Category</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{selectedItem?.name}"? This action cannot be undone.
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
