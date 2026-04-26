import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface LabourCategory {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
}

const LabourCategoriesPage = () => {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<LabourCategory | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<LabourCategory | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [formData, setFormData] = useState({ name: "", code: "", is_active: true });

  const { data: categories = [] } = useQuery({
    queryKey: ["labour-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("labour_categories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as LabourCategory[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        name: data.name.trim(),
        code: data.code.trim().toUpperCase(),
        is_active: data.is_active,
      };
      if (editingCategory) {
        const { error } = await supabase.from("labour_categories").update(payload).eq("id", editingCategory.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("labour_categories").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-categories"] });
      toast.success(editingCategory ? "Category updated" : "Category added");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save category");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Check if category is used by any employee
      const { data: employees } = await supabase
        .from("labour_employees")
        .select("id")
        .eq("category", categoryToDelete?.name || "")
        .limit(1);
      if (employees && employees.length > 0) {
        throw new Error("Cannot delete category that is assigned to employees. Deactivate instead.");
      }
      const { error } = await supabase.from("labour_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-categories"] });
      toast.success("Category deleted");
      setDeleteDialogOpen(false);
      setCategoryToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete category");
    },
  });

  const resetForm = () => {
    setIsDialogOpen(false);
    setEditingCategory(null);
    setFormData({ name: "", code: "", is_active: true });
  };

  const handleEdit = (cat: LabourCategory) => {
    setEditingCategory(cat);
    setFormData({ name: cat.name, code: cat.code, is_active: cat.is_active });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.code) {
      toast.error("Please fill in required fields");
      return;
    }
    saveMutation.mutate(formData);
  };

  const filtered = categories.filter(
    (c) =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    { key: "code", header: "Code", render: (item: LabourCategory) => <span className="font-medium">{item.code}</span> },
    { key: "name", header: "Name" },
    {
      key: "is_active",
      header: "Status",
      render: (item: LabourCategory) => (
        <Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: LabourCategory) => (
        <div className="flex gap-2">
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {isSuperAdmin && (
            <Button variant="ghost" size="icon" onClick={() => { setCategoryToDelete(item); setDeleteDialogOpen(true); }} title="Delete">
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
          {!isSuperAdmin && (
            <span className="text-xs text-muted-foreground">View only</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Labour Categories"
        description="Manage employee categories for the labour productivity module"
        action={{ label: "Add Category", onClick: () => setIsDialogOpen(true), icon: Plus }}
      />

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search category..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 w-[250px]" />
        </div>
      </div>

      <DataTable columns={columns} data={filtered} emptyMessage="No categories found" />

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <Label>Code *</Label>
                <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} placeholder="e.g., SKL" required />
              </div>
              <div>
                <Label>Name *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Skilled" required />
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
                <Label>Active</Label>
              </div>
            </div>
            <DialogFooter className="mt-6">
              <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving..." : "Save"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Category</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete "{categoryToDelete?.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => categoryToDelete && deleteMutation.mutate(categoryToDelete.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
};

export default LabourCategoriesPage;
