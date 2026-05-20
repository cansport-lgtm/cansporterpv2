import { useState } from "react";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerFooter } from "@/components/ui/drawer";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  unit: string;
  category: string | null;
  description: string | null;
  priority: string | null;
  is_active: boolean;
  cost_value: number | null;
  threshold: number | null;
}

const UNITS = ["kg", "g", "ltr", "ml", "pcs", "mtr", "rolls", "sheets"];
const CATEGORIES = ["Chemicals", "Fabric", "Packaging", "Consumables", "Rubber", "Packing Material", "Filler Material", "Other"];

export default function RawMaterialsPage() {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<RawMaterial | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    unit: "kg",
    category: "",
    description: "",
    priority: "medium",
    is_active: true,
    cost_value: 0,
    threshold: 0,
  });

  const { data: materials, isLoading } = useQuery({
    queryKey: ["consumption-raw-materials"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("consumption_raw_materials")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as RawMaterial[];
    },
  });

  // Map RM id -> linked procurement item (set on the Items master). Read-only here.
  const { data: linkedItemByRmId = {} } = useQuery({
    queryKey: ["consumption-rm-linked-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("items")
        .select("id, code, name, consumption_raw_material_id")
        .not("consumption_raw_material_id", "is", null);
      if (error) throw error;
      const map: Record<string, { id: string; code: string; name: string }> = {};
      (data || []).forEach((row: any) => {
        if (row.consumption_raw_material_id) {
          map[row.consumption_raw_material_id] = { id: row.id, code: row.code, name: row.name };
        }
      });
      return map;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("consumption_raw_materials")
          .update(data)
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("consumption_raw_materials")
          .insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-raw-materials"] });
      toast.success(editingMaterial ? "Material updated" : "Material added");
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save material");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("consumption_raw_materials")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["consumption-raw-materials"] });
      toast.success("Material deleted");
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete material");
    },
  });

  const handleOpenDialog = (material?: RawMaterial) => {
    if (material) {
      setEditingMaterial(material);
      setFormData({
        code: material.code,
        name: material.name,
        unit: material.unit,
        category: material.category || "",
        description: material.description || "",
        priority: material.priority || "medium",
        is_active: material.is_active,
        cost_value: material.cost_value || 0,
        threshold: material.threshold || 0,
      });
    } else {
      setEditingMaterial(null);
      setFormData({
        code: "",
        name: "",
        unit: "kg",
        category: "",
        description: "",
        priority: "medium",
        is_active: true,
        cost_value: 0,
        threshold: 0,
      });
    }
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingMaterial(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({
      ...formData,
      id: editingMaterial?.id,
    });
  };

  const formContent = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Code *</Label>
          <Input
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            placeholder="RM001"
            required
          />
        </div>
        <div className="space-y-2">
          <Label>Unit *</Label>
          <Select value={formData.unit} onValueChange={(v) => setFormData({ ...formData, unit: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map((u) => (
                <SelectItem key={u} value={u}>{u}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Name *</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Material name"
          required
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={formData.category} onValueChange={(v) => setFormData({ ...formData, category: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Material Priority</Label>
          <Select value={formData.priority} onValueChange={(v) => setFormData({ ...formData, priority: v })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Cost Value (per unit)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={formData.cost_value}
            onChange={(e) => setFormData({ ...formData, cost_value: parseFloat(e.target.value) || 0 })}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-2">
          <Label>Threshold (Min Stock)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={formData.threshold}
            onChange={(e) => setFormData({ ...formData, threshold: parseFloat(e.target.value) || 0 })}
            placeholder="0"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Optional description"
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          checked={formData.is_active}
          onCheckedChange={(v) => setFormData({ ...formData, is_active: v })}
        />
        <Label>Active</Label>
      </div>
      {isMobile ? (
        <div className="flex flex-col gap-2 pt-2">
          <Button type="submit" disabled={saveMutation.isPending} className="w-full">
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={handleCloseDialog} className="w-full">
            Cancel
          </Button>
        </div>
      ) : (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCloseDialog}>Cancel</Button>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      )}
    </form>
  );

  return (
    <ERPLayout>
      <div className="space-y-6">
        <div className="page-header">
          <div>
            <h1 className="page-title">Raw Materials Master</h1>
            <p className="page-description">Manage raw materials for consumption tracking</p>
          </div>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Material
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Cost Value</TableHead>
                    <TableHead>Linked Item</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center">Loading...</TableCell>
                    </TableRow>
                  ) : materials?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground">
                        No raw materials found. Add your first material.
                      </TableCell>
                    </TableRow>
                  ) : (
                    materials?.map((material) => (
                      <TableRow key={material.id}>
                        <TableCell className="font-mono">{material.code}</TableCell>
                        <TableCell className="font-medium">{material.name}</TableCell>
                        <TableCell>{material.unit}</TableCell>
                        <TableCell>{material.category || "-"}</TableCell>
                        <TableCell className="text-right">{(material.cost_value || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-xs">
                          {linkedItemByRmId[material.id]
                            ? `${linkedItemByRmId[material.id].code} · ${linkedItemByRmId[material.id].name}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={material.priority === "high" ? "destructive" : material.priority === "low" ? "outline" : "secondary"}>
                            {(material.priority || "medium").charAt(0).toUpperCase() + (material.priority || "medium").slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={material.is_active ? "default" : "secondary"}>
                            {material.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => handleOpenDialog(material)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteId(material.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Mobile card list */}
            <div className="md:hidden divide-y">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground">Loading...</div>
              ) : materials?.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground">No raw materials found.</div>
              ) : (
                materials?.map((material) => (
                  <div key={material.id} className="p-3 flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{material.name}</span>
                        <Badge variant={material.is_active ? "default" : "secondary"} className="text-xs shrink-0">
                          {material.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="font-mono">{material.code}</span>
                        <span>{material.unit}</span>
                        {material.category && <span>{material.category}</span>}
                        <span>₹{(material.cost_value || 0).toFixed(2)}</span>
                        {linkedItemByRmId[material.id] && (
                          <span>↔ {linkedItemByRmId[material.id].code}</span>
                        )}
                      </div>
                      <Badge variant={material.priority === "high" ? "destructive" : material.priority === "low" ? "outline" : "secondary"} className="text-xs">
                        {(material.priority || "medium").charAt(0).toUpperCase() + (material.priority || "medium").slice(1)}
                      </Badge>
                    </div>
                    <div className="flex shrink-0">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(material)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setDeleteId(material.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {/* Mobile: Drawer, Desktop: Dialog */}
        {isMobile ? (
          <Drawer open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>{editingMaterial ? "Edit Material" : "Add Raw Material"}</DrawerTitle>
              </DrawerHeader>
              <ScrollArea className="px-4 pb-4 max-h-[70vh]">
                {formContent}
              </ScrollArea>
            </DrawerContent>
          </Drawer>
        ) : (
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingMaterial ? "Edit Material" : "Add Raw Material"}</DialogTitle>
              </DialogHeader>
              {formContent}
            </DialogContent>
          </Dialog>
        )}

        <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Material?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this raw material and all related BOM entries.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
