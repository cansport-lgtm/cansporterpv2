import { useState, useEffect } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Search, Pencil, Package, AlertTriangle, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

interface SparePart {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  unit_of_measure: string | null;
  minimum_stock: number;
  current_stock: number;
  unit_cost: number | null;
  location: string | null;
  is_active: boolean;
}

export default function SparePartsPage() {
  const { hasRole } = useAuth();
  const canManage = hasRole('super_admin') || hasRole('maintenance_manager') || hasRole('manager');
  const [parts, setParts] = useState<SparePart[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingPart, setEditingPart] = useState<SparePart | null>(null);
  const [deletingPart, setDeletingPart] = useState<SparePart | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    category: "",
    unit_of_measure: "",
    minimum_stock: 0,
    current_stock: 0,
    unit_cost: "",
    location: "",
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("spare_parts")
        .select("*")
        .eq("is_active", true)
        .order("code");

      if (error) throw error;
      if (data) setParts(data);
    } catch (error) {
      console.error("Error fetching data:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!formData.code || !formData.name) {
      toast.error("Please fill in required fields");
      return;
    }

    try {
      if (editingPart) {
        const { error } = await supabase
          .from("spare_parts")
          .update({
            code: formData.code,
            name: formData.name,
            description: formData.description || null,
            category: formData.category || null,
            unit_of_measure: formData.unit_of_measure || null,
            minimum_stock: formData.minimum_stock,
            current_stock: formData.current_stock,
            unit_cost: formData.unit_cost ? parseFloat(formData.unit_cost) : null,
            location: formData.location || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingPart.id);

        if (error) throw error;
        toast.success("Spare part updated");
      } else {
        const { error } = await supabase.from("spare_parts").insert({
          code: formData.code,
          name: formData.name,
          description: formData.description || null,
          category: formData.category || null,
          unit_of_measure: formData.unit_of_measure || null,
          minimum_stock: formData.minimum_stock,
          current_stock: formData.current_stock,
          unit_cost: formData.unit_cost ? parseFloat(formData.unit_cost) : null,
          location: formData.location || null,
        });

        if (error) throw error;
        toast.success("Spare part created");
      }

      setIsDialogOpen(false);
      resetForm();
      fetchData();
    } catch (error: any) {
      console.error("Error saving spare part:", error);
      toast.error(error.message || "Failed to save spare part");
    }
  };

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      category: "",
      unit_of_measure: "",
      minimum_stock: 0,
      current_stock: 0,
      unit_cost: "",
      location: "",
    });
    setEditingPart(null);
  };

  const openEditDialog = (part: SparePart) => {
    setEditingPart(part);
    setFormData({
      code: part.code,
      name: part.name,
      description: part.description || "",
      category: part.category || "",
      unit_of_measure: part.unit_of_measure || "",
      minimum_stock: part.minimum_stock,
      current_stock: part.current_stock,
      unit_cost: part.unit_cost?.toString() || "",
      location: part.location || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingPart) return;
    try {
      const { error } = await supabase
        .from("spare_parts")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", deletingPart.id);
      if (error) throw error;
      toast.success("Spare part deleted");
      setDeleteDialogOpen(false);
      setDeletingPart(null);
      fetchData();
    } catch (error: any) {
      toast.error(error.message || "Failed to delete spare part");
    }
  };

  // Extract numeric part from code for proper sorting
  const extractNumber = (code: string): number => {
    const match = code.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  };

  // Get unique categories for filter
  const categories = [...new Set(parts.map((p) => p.category).filter(Boolean))] as string[];

  const filteredParts = parts
    .filter((p) => {
      const matchesSearch =
        p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.category?.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === "all" || p.category === categoryFilter;
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => {
      // First sort by prefix (e.g., ELE, MEC)
      const prefixA = a.code.replace(/[0-9-]/g, "");
      const prefixB = b.code.replace(/[0-9-]/g, "");
      if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
      // Then sort by numeric part
      return extractNumber(a.code) - extractNumber(b.code);
    });

  const getStockStatus = (current: number, minimum: number) => {
    if (current <= 0) return { label: "Out of Stock", color: "bg-red-500" };
    if (current <= minimum) return { label: "Low Stock", color: "bg-amber-500" };
    return { label: "In Stock", color: "bg-green-500" };
  };

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Name" },
    { key: "category", header: "Category", render: (row: SparePart) => row.category || "-" },
    { key: "unit_of_measure", header: "UOM", render: (row: SparePart) => row.unit_of_measure || "-" },
    { key: "location", header: "Location", render: (row: SparePart) => row.location || "-" },
    { key: "current_stock", header: "Stock", render: (row: SparePart) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{row.current_stock}</span>
          <span className="text-muted-foreground text-xs">/ {row.minimum_stock} min</span>
          {row.current_stock <= row.minimum_stock && <AlertTriangle className="h-4 w-4 text-amber-500" />}
        </div>
      ),
    },
    { key: "minimum_stock", header: "Status", render: (row: SparePart) => {
        const status = getStockStatus(row.current_stock, row.minimum_stock);
        return <Badge className={`${status.color} text-white`}>{status.label}</Badge>;
      },
    },
    { key: "unit_cost", header: "Unit Cost", render: (row: SparePart) => (row.unit_cost ? `Rs. ${row.unit_cost.toFixed(2)}` : "-") },
    ...(canManage ? [{ key: "id", header: "Actions", render: (row: SparePart) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => openEditDialog(row)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => { setDeletingPart(row); setDeleteDialogOpen(true); }}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    }] : []),
  ];

  const lowStockCount = parts.filter((p) => p.current_stock <= p.minimum_stock).length;

  return (
    <ERPLayout>
      <PageHeader
        title="Spare Parts"
        description="Manage spare parts inventory for maintenance"
        action={{
          label: "Add Spare Part",
          onClick: () => { resetForm(); setIsDialogOpen(true); },
        }}
      />

      {lowStockCount > 0 && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          <span className="text-sm">
            <strong>{lowStockCount}</strong> spare part(s) are at or below minimum stock level
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search spare parts..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="text-center py-8 text-muted-foreground">Loading...</div>
      ) : (
        <DataTable columns={columns} data={filteredParts} />
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              {editingPart ? "Edit Spare Part" : "New Spare Part"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Code *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g., SP-001"
                />
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  placeholder="e.g., Bearings"
                />
              </div>
            </div>

            <div>
              <Label>Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter spare part name"
              />
            </div>

            <div>
              <Label>Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Brief description"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Unit of Measure</Label>
                <Input
                  value={formData.unit_of_measure}
                  onChange={(e) => setFormData({ ...formData, unit_of_measure: e.target.value })}
                  placeholder="e.g., Pcs, Kg"
                />
              </div>
              <div>
                <Label>Location</Label>
                <Input
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g., Shelf A-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Current Stock</Label>
                <Input
                  type="number"
                  value={formData.current_stock}
                  onChange={(e) => setFormData({ ...formData, current_stock: parseInt(e.target.value) || 0 })}
                  min={0}
                />
              </div>
              <div>
                <Label>Minimum Stock</Label>
                <Input
                  type="number"
                  value={formData.minimum_stock}
                  onChange={(e) => setFormData({ ...formData, minimum_stock: parseInt(e.target.value) || 0 })}
                  min={0}
                />
              </div>
              <div>
                <Label>Unit Cost (Rs.)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.unit_cost}
                  onChange={(e) => setFormData({ ...formData, unit_cost: e.target.value })}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editingPart ? "Update" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Spare Part</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingPart?.name}" ({deletingPart?.code})? This will deactivate the spare part.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
