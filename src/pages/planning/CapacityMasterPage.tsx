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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface CapacityForm {
  department_id: string;
  machine_id: string;
  product_id: string;
  capacity_per_hour: number;
  capacity_per_day: number;
  working_hours_per_day: number;
  is_active: boolean;
  remarks: string;
}

const defaultForm: CapacityForm = {
  department_id: "",
  machine_id: "",
  product_id: "",
  capacity_per_hour: 0,
  capacity_per_day: 0,
  working_hours_per_day: 8,
  is_active: true,
  remarks: "",
};

export default function CapacityMasterPage() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<CapacityForm>(defaultForm);

  const { data: capacities, isLoading } = useQuery({
    queryKey: ["capacity-master-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("capacity_master")
        .select("*, production_departments(name), machines(name, code), products(code, name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const { data: machines } = useQuery({
    queryKey: ["machines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("machines")
        .select("*")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  const { data: products } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .order("code");
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: CapacityForm) => {
      const payload = {
        department_id: data.department_id || null,
        machine_id: data.machine_id || null,
        product_id: data.product_id || null,
        capacity_per_hour: data.capacity_per_hour,
        capacity_per_day: data.capacity_per_day,
        working_hours_per_day: data.working_hours_per_day,
        is_active: data.is_active,
        remarks: data.remarks || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from("capacity_master")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("capacity_master").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["capacity-master-list"] });
      toast.success(editingId ? "Capacity updated" : "Capacity added");
      handleClose();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save capacity");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("capacity_master").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["capacity-master-list"] });
      toast.success("Capacity deleted");
      setDeleteId(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete capacity");
    },
  });

  const handleClose = () => {
    setIsOpen(false);
    setEditingId(null);
    setForm(defaultForm);
  };

  const handleEdit = (capacity: any) => {
    setEditingId(capacity.id);
    setForm({
      department_id: capacity.department_id || "",
      machine_id: capacity.machine_id || "",
      product_id: capacity.product_id || "",
      capacity_per_hour: capacity.capacity_per_hour,
      capacity_per_day: capacity.capacity_per_day,
      working_hours_per_day: capacity.working_hours_per_day || 8,
      is_active: capacity.is_active,
      remarks: capacity.remarks || "",
    });
    setIsOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  // Auto-calculate capacity per day
  const handleCapacityPerHourChange = (value: number) => {
    setForm({
      ...form,
      capacity_per_hour: value,
      capacity_per_day: value * form.working_hours_per_day,
    });
  };

  const handleWorkingHoursChange = (value: number) => {
    setForm({
      ...form,
      working_hours_per_day: value,
      capacity_per_day: form.capacity_per_hour * value,
    });
  };

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Capacity Master"
          description="Configure production capacity by machine/department"
        >
          <Button onClick={() => { setForm(defaultForm); setEditingId(null); setIsOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Capacity
          </Button>
        </PageHeader>

        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Capacity" : "Add Capacity"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Department</Label>
                  <Select
                    value={form.department_id}
                    onValueChange={(v) => setForm({ ...form, department_id: v })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select department" />
                    </SelectTrigger>
                    <SelectContent>
                      {departments?.map((dept: any) => (
                        <SelectItem key={dept.id} value={dept.id}>
                          {dept.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                    <div className="space-y-2">
                      <Label>Machine</Label>
                      <Select
                        value={form.machine_id}
                        onValueChange={(v) => setForm({ ...form, machine_id: v })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select machine" />
                        </SelectTrigger>
                        <SelectContent>
                          {machines?.map((m: any) => (
                            <SelectItem key={m.id} value={m.id}>
                              {m.code} - {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Product</Label>
                    <Select
                      value={form.product_id}
                      onValueChange={(v) => setForm({ ...form, product_id: v })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select product" />
                      </SelectTrigger>
                      <SelectContent>
                        {products?.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.code} - {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Capacity/Hour</Label>
                      <Input
                        type="number"
                        value={form.capacity_per_hour}
                        onChange={(e) => handleCapacityPerHourChange(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Working Hours</Label>
                      <Input
                        type="number"
                        value={form.working_hours_per_day}
                        onChange={(e) => handleWorkingHoursChange(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Capacity/Day</Label>
                      <Input
                        type="number"
                        value={form.capacity_per_day}
                        onChange={(e) => setForm({ ...form, capacity_per_day: Number(e.target.value) })}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Remarks</Label>
                    <Textarea
                      value={form.remarks}
                      onChange={(e) => setForm({ ...form, remarks: e.target.value })}
                      rows={2}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Switch
                      checked={form.is_active}
                      onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                    />
                    <Label>Active</Label>
                  </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        <Card>
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Cap/Hour</TableHead>
                  <TableHead className="text-right">Hours/Day</TableHead>
                  <TableHead className="text-right">Cap/Day</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : capacities?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      No capacity data configured
                    </TableCell>
                  </TableRow>
                ) : (
                  capacities?.map((cap: any) => (
                    <TableRow key={cap.id}>
                      <TableCell>{cap.production_departments?.name || "-"}</TableCell>
                      <TableCell>
                        {cap.machines ? `${cap.machines.code} - ${cap.machines.name}` : "-"}
                      </TableCell>
                      <TableCell>
                        {cap.products ? `${cap.products.code} - ${cap.products.name}` : "-"}
                      </TableCell>
                      <TableCell className="text-right">{cap.capacity_per_hour}</TableCell>
                      <TableCell className="text-right">{cap.working_hours_per_day}</TableCell>
                      <TableCell className="text-right font-medium">{cap.capacity_per_day}</TableCell>
                      <TableCell>
                        <Badge variant={cap.is_active ? "default" : "secondary"}>
                          {cap.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleEdit(cap)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteId(cap.id)}
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
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Capacity</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this capacity configuration?
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
    </ERPLayout>
  );
}
