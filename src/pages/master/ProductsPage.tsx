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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  grade_id: string | null;
  uom_id: string | null;
  standard_output_rate: number | null;
  standard_cost: number | null;
  standard_selling_price: number | null;
  is_active: boolean | null;
  grades?: { name: string } | null;
  units_of_measure?: { name: string } | null;
}

export default function ProductsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    grade_id: "",
    uom_id: "",
    standard_output_rate: 0,
    standard_cost: 0,
    standard_selling_price: 0,
    is_active: true,
  });

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, grades(name), units_of_measure(name)")
        .order("code", { ascending: true });
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: grades = [] } = useQuery({
    queryKey: ["grades-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grades")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: uoms = [] } = useQuery({
    queryKey: ["uoms-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units_of_measure")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("products")
          .update({
            code: data.code,
            name: data.name,
            description: data.description || null,
            grade_id: data.grade_id || null,
            uom_id: data.uom_id || null,
            standard_output_rate: data.standard_output_rate || null,
            standard_cost: data.standard_cost || null,
            standard_selling_price: data.standard_selling_price || null,
            is_active: data.is_active,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert({
          code: data.code,
          name: data.name,
          description: data.description || null,
          grade_id: data.grade_id || null,
          uom_id: data.uom_id || null,
          standard_output_rate: data.standard_output_rate || null,
          standard_cost: data.standard_cost || null,
          standard_selling_price: data.standard_selling_price || null,
          is_active: data.is_active,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(selectedItem ? "Product updated" : "Product created");
      resetForm();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      grade_id: "",
      uom_id: "",
      standard_output_rate: 0,
      standard_cost: 0,
      standard_selling_price: 0,
      is_active: true,
    });
    setSelectedItem(null);
    setDialogOpen(false);
  };

  const handleEdit = (item: Product) => {
    setSelectedItem(item);
    setFormData({
      code: item.code,
      name: item.name,
      description: item.description || "",
      grade_id: item.grade_id || "",
      uom_id: item.uom_id || "",
      standard_output_rate: item.standard_output_rate || 0,
      standard_cost: item.standard_cost || 0,
      standard_selling_price: item.standard_selling_price || 0,
      is_active: item.is_active ?? true,
    });
    setDialogOpen(true);
  };

  const handleDelete = (item: Product) => {
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
    {
      key: "grades.name",
      header: "Grade",
      render: (item: Product) => item.grades?.name || "-",
    },
    {
      key: "units_of_measure.name",
      header: "UOM",
      render: (item: Product) => item.units_of_measure?.name || "-",
    },
    { key: "standard_output_rate", header: "Std Output" },
    {
      key: "standard_cost",
      header: "Std Cost / Dz",
      render: (item: Product) =>
        item.standard_cost != null
          ? `Rs. ${Number(item.standard_cost).toLocaleString()}`
          : <span className="text-amber-600 text-xs">⚠ unset</span>,
    },
    {
      key: "standard_selling_price",
      header: "Std Sell / Dz",
      render: (item: Product) =>
        item.standard_selling_price != null && Number(item.standard_selling_price) > 0
          ? `Rs. ${Number(item.standard_selling_price).toLocaleString()}`
          : <span className="text-amber-600 text-xs">⚠ unset</span>,
    },
    {
      key: "is_active",
      header: "Status",
      render: (item: Product) => (
        <span className={item.is_active ? "text-green-500" : "text-red-500"}>
          {item.is_active ? "Active" : "Inactive"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (item: Product) => (
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
          title="Products / SKUs"
          description="Manage products and stock keeping units"
          icon={Database}
          iconColor="bg-purple-500/10 text-purple-500"
          action={{
            label: "Add Product",
            onClick: () => {
              resetForm();
              setDialogOpen(true);
            },
            icon: Plus,
          }}
        />

        <DataTable
          columns={columns}
          data={products}
          emptyMessage={isLoading ? "Loading..." : "No products found"}
        />

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {selectedItem ? "Edit Product" : "Add Product"}
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
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="grade_id">Grade</Label>
                  <Select
                    value={formData.grade_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, grade_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                    <SelectContent>
                      {grades.map((grade) => (
                        <SelectItem key={grade.id} value={grade.id}>
                          {grade.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom_id">Unit of Measure</Label>
                  <Select
                    value={formData.uom_id}
                    onValueChange={(value) =>
                      setFormData({ ...formData, uom_id: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select UOM" />
                    </SelectTrigger>
                    <SelectContent>
                      {uoms.map((uom) => (
                        <SelectItem key={uom.id} value={uom.id}>
                          {uom.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="standard_output_rate">Standard Output Rate</Label>
                  <Input
                    id="standard_output_rate"
                    type="number"
                    value={formData.standard_output_rate}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        standard_output_rate: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="standard_cost">Standard Cost (Rs. per dozen)</Label>
                  <Input
                    id="standard_cost"
                    type="number"
                    step="0.01"
                    value={formData.standard_cost}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        standard_cost: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Used for per-dispatch COGS posting in accounting.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="standard_selling_price">Standard Selling Price (Rs. per dozen)</Label>
                  <Input
                    id="standard_selling_price"
                    type="number"
                    step="0.01"
                    value={formData.standard_selling_price}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        standard_selling_price: parseFloat(e.target.value) || 0,
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">Default sale price auto-filled on sales orders &amp; quotations when no customer-specific price exists.</p>
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
              <AlertDialogTitle>Delete Product</AlertDialogTitle>
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
