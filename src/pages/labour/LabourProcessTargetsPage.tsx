import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Pencil, Trash2, Target, Search } from "lucide-react";
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
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { useIsMobile } from "@/hooks/use-mobile";
import { Textarea } from "@/components/ui/textarea";

interface ProcessTarget {
  id: string;
  process_id: string;
  department_id: string | null;
  full_day_target: number;
  half_day_target: number;
  target_unit: string;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  remarks: string | null;
  created_at: string;
  qa_processes?: { id: string; name: string; code: string };
  production_departments?: { id: string; name: string; code: string };
}

const LabourProcessTargetsPage = () => {
  const queryClient = useQueryClient();
  const { user, hasRole } = useAuth();
  const isMobile = useIsMobile();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<ProcessTarget | null>(null);
  const [targetToDelete, setTargetToDelete] = useState<ProcessTarget | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterDepartment, setFilterDepartment] = useState("all");

  // Only super_admin can manage process targets
  const canManage = hasRole('super_admin');

  const [formData, setFormData] = useState({
    process_id: "",
    department_id: "",
    full_day_target: 0,
    target_unit: "bags",
    is_active: true,
    remarks: "",
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .neq("name", "Trainings")
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: processes = [] } = useQuery({
    queryKey: ["qa-processes-all", formData.department_id],
    queryFn: async () => {
      let query = supabase
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .order("sequence_order");
      
      if (formData.department_id) {
        query = query.eq("department_id", formData.department_id);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: targets = [], isLoading } = useQuery({
    queryKey: ["labour-process-targets", filterDepartment],
    queryFn: async () => {
      let query = supabase
        .from("labour_process_targets")
        .select(`
          *,
          qa_processes(id, name, code),
          production_departments(id, name, code)
        `)
        .order("created_at", { ascending: false });

      if (filterDepartment !== "all") {
        query = query.eq("department_id", filterDepartment);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as ProcessTarget[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      // Set effective_from to today (target applies immediately)
      const today = format(new Date(), "yyyy-MM-dd");
      
      const payload = {
        process_id: data.process_id,
        department_id: data.department_id || null,
        full_day_target: data.full_day_target,
        target_unit: data.target_unit,
        effective_from: today,
        effective_to: null,
        is_active: data.is_active,
        remarks: data.remarks || null,
        created_by: user?.id || null,
      };

      if (editingTarget) {
        // When editing, update effective_from to today so new target applies immediately
        const { error } = await supabase
          .from("labour_process_targets")
          .update({ ...payload, effective_from: today })
          .eq("id", editingTarget.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("labour_process_targets")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-process-targets"] });
      toast.success(editingTarget ? "Target updated" : "Target created");
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to save target");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("labour_process_targets")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["labour-process-targets"] });
      toast.success("Target deleted");
      setDeleteDialogOpen(false);
      setTargetToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete target");
    },
  });

  const resetForm = () => {
    setIsDialogOpen(false);
    setEditingTarget(null);
    setFormData({
      process_id: "",
      department_id: "",
      full_day_target: 0,
      target_unit: "bags",
      is_active: true,
      remarks: "",
    });
  };

  const handleEdit = (target: ProcessTarget) => {
    if (!canManage) {
      toast.error("Only Super Admin can edit process targets");
      return;
    }
    setEditingTarget(target);
    setFormData({
      process_id: target.process_id,
      department_id: target.department_id || "",
      full_day_target: target.full_day_target,
      target_unit: target.target_unit || "bags",
      is_active: target.is_active,
      remarks: target.remarks || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (target: ProcessTarget) => {
    if (!canManage) {
      toast.error("Only Super Admin can delete process targets");
      return;
    }
    setTargetToDelete(target);
    setDeleteDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.process_id) {
      toast.error("Please select a process");
      return;
    }
    if (!formData.full_day_target || formData.full_day_target <= 0) {
      toast.error("Full day target must be greater than 0");
      return;
    }
    saveMutation.mutate(formData);
  };

  const filteredTargets = targets.filter((target) =>
    target.qa_processes?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    target.qa_processes?.code.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    {
      key: "process",
      header: "Process",
      render: (item: ProcessTarget) => (
        <div>
          <p className="font-medium">{item.qa_processes?.name}</p>
          <p className="text-xs text-muted-foreground">{item.qa_processes?.code}</p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      render: (item: ProcessTarget) => item.production_departments?.name || "All Departments",
    },
    {
      key: "full_day_target",
      header: "Full Day Target",
      render: (item: ProcessTarget) => (
        <span className="font-semibold text-primary">
          {item.full_day_target.toLocaleString()} {item.target_unit}
        </span>
      ),
    },
    {
      key: "half_day_target",
      header: "Half Day Target",
      render: (item: ProcessTarget) => (
        <span className="font-medium text-muted-foreground">
          {item.half_day_target.toLocaleString()} {item.target_unit}
        </span>
      ),
    },
    {
      key: "effective_from",
      header: "Effective From",
      render: (item: ProcessTarget) => format(new Date(item.effective_from), "dd MMM yyyy"),
    },
    {
      key: "status",
      header: "Status",
      render: (item: ProcessTarget) => (
        <Badge variant={item.is_active ? "default" : "secondary"}>
          {item.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    ...(canManage ? [{
      key: "actions",
      header: "Actions",
      render: (item: ProcessTarget) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(item)} title="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(item)} title="Delete">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    }] : []),
  ];

  const renderMobileCard = (item: ProcessTarget) => (
    <Card key={item.id} className="mb-3">
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-3">
          <div>
            <p className="font-semibold text-base">{item.qa_processes?.name}</p>
            <p className="text-xs text-muted-foreground">{item.qa_processes?.code}</p>
          </div>
          <Badge variant={item.is_active ? "default" : "secondary"}>
            {item.is_active ? "Active" : "Inactive"}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-primary/10 p-3 rounded-lg text-center">
            <p className="text-xs text-muted-foreground">Full Day</p>
            <p className="text-lg font-bold text-primary">{item.full_day_target}</p>
            <p className="text-xs text-muted-foreground">{item.target_unit}</p>
          </div>
          <div className="bg-muted p-3 rounded-lg text-center">
            <p className="text-xs text-muted-foreground">Half Day</p>
            <p className="text-lg font-bold">{item.half_day_target}</p>
            <p className="text-xs text-muted-foreground">{item.target_unit}</p>
          </div>
        </div>

        <div className="text-sm mb-3">
          <span className="text-muted-foreground">Department: </span>
          <span className="font-medium">{item.production_departments?.name || "All"}</span>
        </div>

        {canManage && (
          <div className="flex gap-2 pt-2 border-t">
            <Button variant="outline" size="sm" className="flex-1" onClick={() => handleEdit(item)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleDelete(item)}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <ERPLayout>
      <PageHeader
        title="Process Targets"
        description={isMobile ? undefined : "Set default productivity targets for each process"}
        action={canManage ? {
          label: isMobile ? "Add" : "Add Target",
          onClick: () => setIsDialogOpen(true),
          icon: Plus,
        } : undefined}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1 sm:flex-none">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search process..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 w-full sm:w-[200px]"
          />
        </div>
        <Select value={filterDepartment} onValueChange={setFilterDepartment}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue placeholder="Department" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Departments</SelectItem>
            {departments.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Data Display */}
      {isMobile ? (
        <div>{filteredTargets.map(renderMobileCard)}</div>
      ) : (
        <DataTable columns={columns} data={filteredTargets} />
      )}

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              {editingTarget ? "Edit Process Target" : "Add Process Target"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Department (Optional)</Label>
              <Select
                value={formData.department_id || "__all__"}
                onValueChange={(value) => setFormData({ ...formData, department_id: value === "__all__" ? "" : value, process_id: "" })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Departments" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All Departments</SelectItem>
                  {departments.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Process *</Label>
              <Select
                value={formData.process_id}
                onValueChange={(value) => setFormData({ ...formData, process_id: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select process" />
                </SelectTrigger>
                <SelectContent>
                  {processes.map((process) => (
                    <SelectItem key={process.id} value={process.id}>
                      {process.code} - {process.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Full Day Target (12 MPH) *</Label>
                <Input
                  type="number"
                  value={formData.full_day_target}
                  onChange={(e) => setFormData({ ...formData, full_day_target: parseInt(e.target.value) || 0 })}
                  min={0}
                />
              </div>
              <div className="space-y-2">
                <Label>Half Day Target (Auto)</Label>
                <Input
                  type="number"
                  value={Math.floor(formData.full_day_target / 2)}
                  disabled
                  className="bg-muted"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Unit</Label>
              <Select
                value={formData.target_unit}
                onValueChange={(value) => setFormData({ ...formData, target_unit: value })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bags">Bags</SelectItem>
                  <SelectItem value="sheets">Sheets</SelectItem>
                  <SelectItem value="gaddi">Gaddi</SelectItem>
                  <SelectItem value="kg">Kg</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
              <strong>Note:</strong> Target applies immediately upon save. When edited, new target will automatically apply to all new entries.
            </div>

            <div className="space-y-2">
              <Label>Remarks</Label>
              <Textarea
                value={formData.remarks}
                onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
                placeholder="Optional notes..."
                rows={2}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : editingTarget ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Target?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the target for "{targetToDelete?.qa_processes?.name}". This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => targetToDelete && deleteMutation.mutate(targetToDelete.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
};

export default LabourProcessTargetsPage;
