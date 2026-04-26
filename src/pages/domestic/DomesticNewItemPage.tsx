import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Search, Package, Pencil, Trash2, Printer } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Product {
  id: string;
  code: string;
  name: string;
  description: string | null;
  uom_id: string | null;
  is_active: boolean | null;
  created_at: string | null;
  units: { name: string } | null;
}

export default function DomesticNewItemPage() {
  const [searchTerm, setSearchTerm] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    uom_id: "",
  });

  const queryClient = useQueryClient();
  const { roles } = useAuth();
  const isSuperAdmin = roles.some(r => r.role === 'super_admin');
  // Fetch units of measure
  const { data: units = [] } = useQuery({
    queryKey: ["units-of-measure"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("units_of_measure")
        .select("id, name, symbol")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch products
  const { data: products = [], isLoading } = useQuery({
    queryKey: ["domestic-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, description, uom_id, is_active, created_at, units:uom_id(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Product[];
    },
  });

  // Toggle active status
  const toggleStatusMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("products")
        .update({ is_active, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item status updated");
      queryClient.invalidateQueries({ queryKey: ["domestic-products"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update status");
    },
  });

  // Delete product mutation (super_admin only)
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Item deleted successfully");
      queryClient.invalidateQueries({ queryKey: ["domestic-products"] });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete item");
    },
  });

  // Create/Update product mutation
  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      if (editingProduct) {
        const { error } = await supabase
          .from("products")
          .update({
            code: data.code,
            name: data.name,
            description: data.description || null,
            uom_id: data.uom_id || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingProduct.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert({
          code: data.code,
          name: data.name,
          description: data.description || null,
          uom_id: data.uom_id || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editingProduct ? "Item updated successfully" : "Item created successfully");
      queryClient.invalidateQueries({ queryKey: ["domestic-products"] });
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save item");
    },
  });

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingProduct(null);
    setFormData({ code: "", name: "", description: "", uom_id: "" });
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      code: product.code,
      name: product.name,
      description: product.description || "",
      uom_id: product.uom_id || "",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = () => {
    if (!formData.code || !formData.name) {
      toast.error("Please fill in code and name");
      return;
    }
    saveMutation.mutate(formData);
  };

  const filteredProducts = products.filter((product) => {
    const searchLower = searchTerm.toLowerCase();
    return (
      product.name.toLowerCase().includes(searchLower) ||
      product.code.toLowerCase().includes(searchLower)
    );
  });

  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const rows = filteredProducts.map(p =>
      `<tr><td>${p.code}</td><td>${p.name}</td><td>${p.description || '-'}</td><td>${p.units?.name || '-'}</td><td>${p.is_active ? 'Active' : 'Inactive'}</td></tr>`
    ).join('');
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Domestic Items List</title><style>
      body{font-family:Arial,sans-serif;padding:20px}
      h1{font-size:18px;margin-bottom:4px}
      p{color:#666;font-size:12px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}
      th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}
      th{background:#f5f5f5;font-weight:600}
      @media print{body{padding:0}}
    </style></head><body>
      <h1>Cansport - Domestic Items List</h1>
      <p>Date: ${new Date().toLocaleDateString('en-IN')} | Total Items: ${filteredProducts.length}</p>
      <table><thead><tr><th>Code</th><th>Name</th><th>Description</th><th>Unit</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
    </body></html>`);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">New Item</h1>
            <p className="text-muted-foreground">
              Create and manage items for domestic sales
            </p>
          </div>
          <div className="flex gap-2">
            {isSuperAdmin && (
              <Button variant="outline" onClick={handlePrint}>
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
            )}
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              if (!open) handleCloseDialog();
              else setIsDialogOpen(true);
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Add New Item
                </Button>
              </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editingProduct ? "Edit Item" : "Add New Item"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="code">Item Code *</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="Enter item code"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Item Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter item name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter item description"
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="uom">Unit of Measure</Label>
                  <Select
                    value={formData.uom_id}
                    onValueChange={(value) => setFormData({ ...formData, uom_id: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {units.map((unit) => (
                        <SelectItem key={unit.id} value={unit.id}>
                          {unit.name} {unit.symbol ? `(${unit.symbol})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={handleCloseDialog}>
                    Cancel
                  </Button>
                  <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : "Save"}
                  </Button>
                </div>
              </div>
            </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Search */}
        <Card>
          <CardContent className="pt-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by item name or code..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Items List
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Item Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8">
                        Loading...
                      </TableCell>
                    </TableRow>
                  ) : filteredProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        No items found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredProducts.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="font-medium">{product.code}</TableCell>
                        <TableCell>{product.name}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {product.description || "-"}
                        </TableCell>
                        <TableCell>{product.units?.name || "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={product.is_active ?? true}
                              onCheckedChange={(checked) =>
                                toggleStatusMutation.mutate({ id: product.id, is_active: checked })
                              }
                            />
                            <span className={`text-xs font-medium ${product.is_active ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}>
                              {product.is_active ? "Active" : "Inactive"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEdit(product)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {isSuperAdmin && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Delete Item</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Are you sure you want to delete "{product.code} - {product.name}"? This action cannot be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => deleteMutation.mutate(product.id)}
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                    >
                                      Delete
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
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
      </div>
    </ERPLayout>
  );
}
