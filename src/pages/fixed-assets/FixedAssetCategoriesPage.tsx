import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Search, Tags } from "lucide-react";
import { toast } from "sonner";

interface AssetCategory {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
}

const defaultFormData = {
  code: "",
  name: "",
  description: "",
  is_active: true,
};

export default function FixedAssetCategoriesPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AssetCategory | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<AssetCategory | null>(null);
  const [formData, setFormData] = useState(defaultFormData);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: categories = [], isLoading } = useQuery({
    queryKey: ["fixed_asset_categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fixed_asset_categories")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as AssetCategory[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingCategory) {
        const { error } = await supabase
          .from("fixed_asset_categories")
          .update({ code: data.code, name: data.name, description: data.description || null, is_active: data.is_active, updated_at: new Date().toISOString() })
          .eq("id", editingCategory.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("fixed_asset_categories")
          .insert({ code: data.code, name: data.name, description: data.description || null, is_active: data.is_active });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed_asset_categories"] });
      toast.success(editingCategory ? "Category updated" : "Category created");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save category");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Check if any assets use this category
      const { count } = await supabase
        .from("fixed_assets")
        .select("id", { count: "exact", head: true })
        .eq("custom_category", deletingCategory?.name || "");
      
      if (count && count > 0) {
        throw new Error("Cannot delete: category is in use by existing assets");
      }

      const { error } = await supabase.from("fixed_asset_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fixed_asset_categories"] });
      toast.success("Category deleted");
      setDeleteDialogOpen(false);
      setDeletingCategory(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete category");
      setDeleteDialogOpen(false);
    },
  });

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingCategory(null);
    setFormData(defaultFormData);
  };

  const handleEdit = (cat: AssetCategory) => {
    setEditingCategory(cat);
    setFormData({
      code: cat.code,
      name: cat.name,
      description: cat.description || "",
      is_active: cat.is_active,
    });
    setDialogOpen(true);
  };

  const handleDelete = (cat: AssetCategory) => {
    setDeletingCategory(cat);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code.trim() || !formData.name.trim()) {
      toast.error("Code and Name are required");
      return;
    }
    saveMutation.mutate(formData);
  };

  const filtered = categories.filter(
    (c) =>
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Asset Categories"
          description="Manage fixed asset category master data"
          icon={Tags}
          iconColor="bg-slate-600 text-white"
          action={{ label: "Add Category", onClick: () => setDialogOpen(true) }}
        />

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-4">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search categories..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
              />
            </div>

            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading...</TableCell>
                    </TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No categories found</TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((cat) => (
                      <TableRow key={cat.id}>
                        <TableCell className="font-mono font-medium">{cat.code}</TableCell>
                        <TableCell className="font-medium">{cat.name}</TableCell>
                        <TableCell className="text-muted-foreground">{cat.description || "-"}</TableCell>
                        <TableCell>
                          <Badge variant={cat.is_active ? "default" : "secondary"}>
                            {cat.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(cat)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(cat)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCloseDialog(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCategory ? "Edit Category" : "Add Category"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code *</Label>
                  <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })} placeholder="e.g. OA" />
                </div>
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Office Assets" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Optional description" rows={2} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
                <Label>Active</Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={handleCloseDialog}>Cancel</Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : editingCategory ? "Update" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Category</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{deletingCategory?.name}"? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deletingCategory && deleteMutation.mutate(deletingCategory.id)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
