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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2, Package } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

const UNIT_OPTIONS = [
  { value: "sheets", label: "Sheets" },
  { value: "dzns", label: "Dzns" },
  { value: "bags", label: "Bags" },
  { value: "ctns", label: "Ctns" },
];

interface PlanningItem {
  id?: string;
  department_id: string;
  code: string;
  name: string;
  description?: string;
  is_active: boolean;
  threshold_inventory: number;
  unit: string;
  costing_value: number;
}

export default function PlanningItemMasterPage() {
  const queryClient = useQueryClient();
  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PlanningItem | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState<PlanningItem>({
    department_id: "",
    code: "",
    name: "",
    description: "",
    is_active: true,
    threshold_inventory: 0,
    unit: "dzns",
    costing_value: 0,
  });

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ["departments-planning-items"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
  });

  // Fetch planning items
  const { data: items, isLoading } = useQuery({
    queryKey: ["planning-items-master", selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("planning_items")
        .select("*, production_departments(name)")
        .order("code");

      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }

      const { data } = await query;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (item: PlanningItem) => {
      if (editingItem?.id) {
        const { error } = await supabase
          .from("planning_items")
          .update({
            department_id: item.department_id,
            code: item.code,
            name: item.name,
            description: item.description || null,
            is_active: item.is_active,
            threshold_inventory: item.threshold_inventory || 0,
            unit: item.unit || "dzns",
            costing_value: item.costing_value || 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("planning_items").insert({
          department_id: item.department_id,
          code: item.code,
          name: item.name,
          description: item.description || null,
          is_active: item.is_active,
          threshold_inventory: item.threshold_inventory || 0,
          unit: item.unit || "dzns",
          costing_value: item.costing_value || 0,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-items-master"] });
      toast.success(editingItem ? "Item updated" : "Item created");
      closeDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save item");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("planning_items").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planning-items-master"] });
      toast.success("Item deleted");
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete item");
    },
  });

  const openAddDialog = () => {
    setEditingItem(null);
    setFormData({
      department_id: selectedDepartment !== "all" ? selectedDepartment : "",
      code: "",
      name: "",
      description: "",
      is_active: true,
      threshold_inventory: 0,
      unit: "dzns",
      costing_value: 0,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: any) => {
    setEditingItem(item);
    setFormData({
      department_id: item.department_id,
      code: item.code,
      name: item.name,
      description: item.description || "",
      is_active: item.is_active,
      threshold_inventory: item.threshold_inventory || 0,
      unit: item.unit || "dzns",
      costing_value: item.costing_value || 0,
    });
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingItem(null);
  };

  const handleSave = () => {
    if (!formData.department_id) {
      toast.error("Please select a department");
      return;
    }
    if (!formData.code.trim()) {
      toast.error("Please enter item code");
      return;
    }
    if (!formData.name.trim()) {
      toast.error("Please enter item name");
      return;
    }
    saveMutation.mutate(formData);
  };

  const getDepartmentName = (deptId: string) => {
    return departments?.find((d: any) => d.id === deptId)?.name || "-";
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Planning Item Master"
          description="Manage department-wise items for production planning"
          icon={Package}
        >
          <Button onClick={openAddDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Add Item
          </Button>
        </PageHeader>

        {/* Filters */}
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-4">
              <Label>Filter by Department:</Label>
              <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                <SelectTrigger className="w-64">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Departments</SelectItem>
                  {departments?.map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Items Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Costing Value</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                   <TableCell colSpan={7} className="text-center py-8">
                       Loading...
                     </TableCell>
                  </TableRow>
                ) : items?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      No items found. Add your first planning item.
                    </TableCell>
                  </TableRow>
                ) : (
                  items?.map((item: any) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.code}</TableCell>
                      <TableCell>{item.name}</TableCell>
                      <TableCell>{item.production_departments?.name || "-"}</TableCell>
                      <TableCell className="text-muted-foreground max-w-xs truncate">
                        {item.description || "-"}
                      </TableCell>
                      <TableCell>{item.costing_value || 0}</TableCell>
                      <TableCell>
                        <Badge variant={item.is_active ? "default" : "secondary"}>
                          {item.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(item)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(item.id)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Add/Edit Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingItem ? "Edit Item" : "Add Planning Item"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Department *</Label>
                <Select
                  value={formData.department_id}
                  onValueChange={(v) => setFormData({ ...formData, department_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments?.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Item Code *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g., CUT-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Item Name *</Label>
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Gloves Cutting"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional description..."
                  rows={2}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Threshold Inventory</Label>
                  <Input
                    type="number"
                    min="0"
                    value={formData.threshold_inventory}
                    onChange={(e) => setFormData({ ...formData, threshold_inventory: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g., 100"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Costing Value</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.costing_value}
                    onChange={(e) => setFormData({ ...formData, costing_value: parseFloat(e.target.value) || 0 })}
                    placeholder="e.g., 25.50"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Unit</Label>
                  <Select
                    value={formData.unit}
                    onValueChange={(v) => setFormData({ ...formData, unit: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {UNIT_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeDialog}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saveMutation.isPending}>
                  {editingItem ? "Update" : "Create"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Item?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. This will permanently delete the planning item.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteId && deleteMutation.mutate(deleteId)}
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
