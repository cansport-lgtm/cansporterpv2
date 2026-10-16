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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { AutoCodeField } from "@/components/shared/AutoCodeField";

interface ConsumptionCategory {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface ConsumptionSubcategory {
  id: string;
  category_id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
}

const ConsumptionSubcategoriesPage = () => {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingSubcategory, setEditingSubcategory] = useState<ConsumptionSubcategory | null>(null);
  const [subcategoryToDelete, setSubcategoryToDelete] = useState<ConsumptionSubcategory | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [formData, setFormData] = useState({ category_id: "", name: "", code: "", is_active: true });

  const { data: categories = [] } = useQuery({
    queryKey: ["consumption-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_categories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as ConsumptionCategory[];
    },
  });

  const { data: subcategories = [] } = useQuery({
    queryKey: ["consumption-subcategories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_subcategories")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as ConsumptionSubcategory[];
    },
  });

  const categoryById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const isInUse = async (id: string) => {
    const { data } = await supabase
      .from("items")
      .select("id")
      .eq("raw_material_subcategory_id", id)
      .limit(1);
    return !!data && data.length > 0;
  };

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const payload = {
        category_id: data.category_id,
        name: data.name.trim(),
        is_active: data.is_active,
      };
      if (editingSubcategory) {
        // Moving a sub-category to another category would leave its raw
        // materials pointing at a category it no longer belongs to.
        if (data.category_id !== editingSubcategory.category_id && (await isInUse(editingSubcategory.id))) {
          throw new Error("Cannot change the category of a sub-category assigned to raw materials.");
        }
        const { error } = await supabase.from("consumption_subcategories").update(payload).eq("id", editingSubcategory.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("consumption_subcategories").insert({ ...payload, code: "" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-subcategories"] });
      queryClient.invalidateQueries({ queryKey: ["consumption-raw-materials"] });
      toast.success(editingSubcategory ? "Sub-category updated" : "Sub-category added");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to save sub-category");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      if (await isInUse(id)) {
        throw new Error("Cannot delete sub-category assigned to raw materials. Deactivate instead.");
      }
      const { error } = await supabase.from("consumption_subcategories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-subcategories"] });
      toast.success("Sub-category deleted");
      setDeleteDialogOpen(false);
      setSubcategoryToDelete(null);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete sub-category");
    },
  });

  const resetForm = () => {
    setIsDialogOpen(false);
    setEditingSubcategory(null);
    setFormData({ category_id: "", name: "", code: "", is_active: true });
  };

  const handleAdd = () => {
    setFormData({
      category_id: categoryFilter !== "all" ? categoryFilter : "",
      name: "",
      code: "",
      is_active: true,
    });
    setIsDialogOpen(true);
  };

  const handleEdit = (sub: ConsumptionSubcategory) => {
    setEditingSubcategory(sub);
    setFormData({ category_id: sub.category_id, name: sub.name, code: sub.code, is_active: sub.is_active });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.category_id || !formData.name) {
      toast.error("Please fill in required fields");
      return;
    }
    saveMutation.mutate(formData);
  };

  const needle = searchTerm.toLowerCase();
  const filtered = subcategories.filter(
    (s) =>
      (categoryFilter === "all" || s.category_id === categoryFilter) &&
      (s.name.toLowerCase().includes(needle) ||
        s.code.toLowerCase().includes(needle) ||
        (categoryById[s.category_id]?.name || "").toLowerCase().includes(needle))
  );

  // Active categories, plus the one being edited even if it was deactivated.
  const selectableCategories = categories.filter((c) => c.is_active || c.id === formData.category_id);

  const columns = [
    { key: "code", header: "Code", render: (item: ConsumptionSubcategory) => <span className="font-medium">{item.code}</span> },
    { key: "name", header: "Name" },
    {
      key: "category_id",
      header: "Category",
      render: (item: ConsumptionSubcategory) => categoryById[item.category_id]?.name || "-",
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: ConsumptionSubcategory) => (
        <Badge variant={item.is_active ? "default" : "secondary"}>{item.is_active ? "Active" : "Inactive"}</Badge>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: ConsumptionSubcategory) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { setSubcategoryToDelete(item); setDeleteDialogOpen(true); }}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ERPLayout>
      <PageHeader
        title="Sub-Category Master"
        description="Manage raw material sub-categories under each category"
        action={{ label: "Add Sub-Category", onClick: handleAdd, icon: Plus }}
      />

      <div className="flex flex-wrap gap-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search sub-category..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-9 w-[250px]" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={filtered} emptyMessage="No sub-categories found" />

      <Dialog open={isDialogOpen} onOpenChange={(open) => (open ? setIsDialogOpen(true) : resetForm())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingSubcategory ? "Edit Sub-Category" : "Add Sub-Category"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <Label>Category *</Label>
                <Select value={formData.category_id} onValueChange={(value) => setFormData({ ...formData, category_id: value })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <AutoCodeField
                entity="consumption_subcategories"
                value={editingSubcategory?.code}
                isEdit={!!editingSubcategory}
                label="Code"
                className="space-y-0"
              />
              <div>
                <Label>Name *</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} placeholder="e.g., Acids" required />
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
            <AlertDialogTitle>Delete Sub-Category</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete "{subcategoryToDelete?.name}"? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => subcategoryToDelete && deleteMutation.mutate(subcategoryToDelete.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
};

export default ConsumptionSubcategoriesPage;
