import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2 } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface SubDepartment {
  id: string;
  department_id: string;
  code: string;
  name: string;
  sequence_order: number | null;
  is_active: boolean | null;
}

interface SubDepartmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  department: { id: string; name: string };
}

export default function SubDepartmentsDialog({ open, onOpenChange, department }: SubDepartmentsDialogProps) {
  const queryClient = useQueryClient();
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SubDepartment | null>(null);
  const [formData, setFormData] = useState({ code: "", name: "", sequence_order: 0, is_active: true });

  const { data: subDepartments = [], isLoading } = useQuery({
    queryKey: ["production_sub_departments", department.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_sub_departments")
        .select("*")
        .eq("department_id", department.id)
        .order("sequence_order", { ascending: true });
      if (error) throw error;
      return data as SubDepartment[];
    },
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("production_sub_departments")
          .update({ code: data.code, name: data.name, sequence_order: data.sequence_order, is_active: data.is_active })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("production_sub_departments")
          .insert({ department_id: department.id, code: data.code, name: data.name, sequence_order: data.sequence_order, is_active: data.is_active });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production_sub_departments", department.id] });
      toast.success(selectedItem ? "Sub-department updated" : "Sub-department created");
      resetForm();
    },
    onError: (error: Error) => { toast.error(error.message); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("production_sub_departments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["production_sub_departments", department.id] });
      toast.success("Sub-department deleted");
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    },
    onError: (error: Error) => { toast.error(error.message); },
  });

  const resetForm = () => {
    setFormData({ code: "", name: "", sequence_order: 0, is_active: true });
    setSelectedItem(null);
    setEditDialogOpen(false);
  };

  const handleEdit = (item: SubDepartment) => {
    setSelectedItem(item);
    setFormData({ code: item.code, name: item.name, sequence_order: item.sequence_order || 0, is_active: item.is_active ?? true });
    setEditDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate({ ...formData, id: selectedItem?.id });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sub-Departments — {department.name}</DialogTitle>
          </DialogHeader>

          <div className="flex justify-end mb-2">
            <Button size="sm" onClick={() => { resetForm(); setEditDialogOpen(true); }}>
              <Plus className="h-4 w-4 mr-1" /> Add Sub-Department
            </Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : subDepartments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No sub-departments yet. Click "Add Sub-Department" to create one.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subDepartments.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell>{sub.code}</TableCell>
                    <TableCell>{sub.name}</TableCell>
                    <TableCell>{sub.sequence_order}</TableCell>
                    <TableCell>
                      <span className={sub.is_active ? "text-green-500" : "text-red-500"}>
                        {sub.is_active ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(sub)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setSelectedItem(sub); setDeleteDialogOpen(true); }}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit/Add Sub-Department Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedItem ? "Edit Sub-Department" : "Add Sub-Department"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Code</Label>
                <Input value={formData.code} onChange={(e) => setFormData({ ...formData, code: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} required />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Sequence Order</Label>
              <Input type="number" value={formData.sequence_order} onChange={(e) => setFormData({ ...formData, sequence_order: parseInt(e.target.value) || 0 })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={formData.is_active} onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })} />
              <Label>Active</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
              <Button type="submit" disabled={saveMutation.isPending}>{saveMutation.isPending ? "Saving..." : "Save"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sub-Department</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedItem?.name}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => selectedItem && deleteMutation.mutate(selectedItem.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
