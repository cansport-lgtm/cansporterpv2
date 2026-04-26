import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
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
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Plus, Settings2, Trash2, Pencil, BookOpen, Shield } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { toast } from "sonner";

interface ProcessParameter {
  id?: string;
  parameter_name: string;
  parameter_type: string;
  unit: string;
  min_value: number | null;
  max_value: number | null;
  is_required: boolean;
  sequence_order: number;
}

export default function ProcessMasterPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [showParametersDialog, setShowParametersDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [processToDelete, setProcessToDelete] = useState<any>(null);
  const [selectedProcess, setSelectedProcess] = useState<any>(null);
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    description: "",
    department_id: "",
    sequence_order: 1,
    is_active: true,
    is_export_allowed: false,
    requires_inspection_tag: false,
  });
  const [parameters, setParameters] = useState<ProcessParameter[]>([]);

  // Fetch processes
  const { data: processes = [], isLoading } = useQuery({
    queryKey: ["qa-processes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("qa_processes")
        .select("*, production_departments(name)")
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch parameters for a process
  const { data: processParameters = [] } = useQuery({
    queryKey: ["qa-process-parameters", selectedProcess?.id],
    queryFn: async () => {
      if (!selectedProcess?.id) return [];
      const { data, error } = await supabase
        .from("qa_process_parameters")
        .select("*")
        .eq("process_id", selectedProcess.id)
        .order("sequence_order");
      if (error) throw error;
      return data;
    },
    enabled: !!selectedProcess?.id,
  });

  // Create/Update process mutation
  const processMutation = useMutation({
    mutationFn: async (data: typeof formData & { id?: string }) => {
      if (data.id) {
        const { error } = await supabase
          .from("qa_processes")
          .update({
           code: data.code,
            name: data.name,
            description: data.description,
            department_id: data.department_id || null,
            sequence_order: data.sequence_order,
            is_active: data.is_active,
            is_export_allowed: data.is_export_allowed,
            requires_inspection_tag: data.requires_inspection_tag,
          })
          .eq("id", data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("qa_processes").insert({
          code: data.code,
          name: data.name,
          description: data.description,
          department_id: data.department_id || null,
          sequence_order: data.sequence_order,
          is_active: data.is_active,
          is_export_allowed: data.is_export_allowed,
          requires_inspection_tag: data.requires_inspection_tag,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-processes"] });
      toast.success(selectedProcess ? "Process updated!" : "Process created!");
      setShowDialog(false);
      resetForm();
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Save parameters mutation
  const parametersMutation = useMutation({
    mutationFn: async ({ processId, params }: { processId: string; params: ProcessParameter[] }) => {
      // Delete existing parameters
      await supabase.from("qa_process_parameters").delete().eq("process_id", processId);
      
      // Insert new parameters
      if (params.length > 0) {
        const { error } = await supabase.from("qa_process_parameters").insert(
          params.map((p, idx) => ({
            process_id: processId,
            parameter_name: p.parameter_name,
            parameter_type: p.parameter_type,
            unit: p.unit || null,
            min_value: p.min_value,
            max_value: p.max_value,
            is_required: p.is_required,
            sequence_order: idx + 1,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-process-parameters"] });
      toast.success("Parameters saved!");
      setShowParametersDialog(false);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  // Delete process mutation
  const deleteMutation = useMutation({
    mutationFn: async (processId: string) => {
      // Check if there are any inspections linked to this process
      const { count, error: checkError } = await supabase
        .from("qa_inspections")
        .select("*", { count: "exact", head: true })
        .eq("process_id", processId);
      
      if (checkError) throw checkError;
      
      if (count && count > 0) {
        throw new Error(`Cannot delete: ${count} inspection(s) are linked to this process. Please delete the inspections first.`);
      }
      
      // First delete associated parameters
      await supabase.from("qa_process_parameters").delete().eq("process_id", processId);
      // Then delete the process
      const { error } = await supabase.from("qa_processes").delete().eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-processes"] });
      toast.success("Process deleted successfully!");
      setShowDeleteDialog(false);
      setProcessToDelete(null);
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const resetForm = () => {
    setFormData({
      code: "",
      name: "",
      description: "",
      department_id: "",
      sequence_order: 1,
      is_active: true,
      is_export_allowed: false,
      requires_inspection_tag: false,
    });
    setSelectedProcess(null);
  };

  const handleEdit = (process: any) => {
    setSelectedProcess(process);
    setFormData({
      code: process.code,
      name: process.name,
      description: process.description || "",
      department_id: process.department_id || "",
      sequence_order: process.sequence_order || 1,
      is_active: process.is_active,
      is_export_allowed: process.is_export_allowed ?? false,
      requires_inspection_tag: process.requires_inspection_tag ?? false,
    });
    setShowDialog(true);
  };

  const handleDelete = (process: any) => {
    setProcessToDelete(process);
    setShowDeleteDialog(true);
  };

  const confirmDelete = () => {
    if (processToDelete?.id) {
      deleteMutation.mutate(processToDelete.id);
    }
  };

  const handleManageParameters = (process: any) => {
    setSelectedProcess(process);
    setShowParametersDialog(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    processMutation.mutate({ ...formData, id: selectedProcess?.id });
  };

  const addParameter = () => {
    setParameters([
      ...parameters,
      {
        parameter_name: "",
        parameter_type: "text",
        unit: "",
        min_value: null,
        max_value: null,
        is_required: false,
        sequence_order: parameters.length + 1,
      },
    ]);
  };

  const updateParameter = (index: number, field: keyof ProcessParameter, value: any) => {
    const updated = [...parameters];
    updated[index] = { ...updated[index], [field]: value };
    setParameters(updated);
  };

  const removeParameter = (index: number) => {
    setParameters(parameters.filter((_, i) => i !== index));
  };

  const saveParameters = () => {
    if (!selectedProcess?.id) return;
    parametersMutation.mutate({ processId: selectedProcess.id, params: parameters });
  };

  // Set parameters when dialog opens
  const openParametersDialog = (process: any) => {
    setSelectedProcess(process);
    setShowParametersDialog(true);
  };

  // Load parameters when processParameters data changes and dialog is open
  useEffect(() => {
    if (processParameters.length > 0 && showParametersDialog) {
      setParameters(processParameters as ProcessParameter[]);
    }
  }, [processParameters, showParametersDialog]);

  // Toggle export allowed mutation
  const toggleExportMutation = useMutation({
    mutationFn: async ({ processId, value }: { processId: string; value: boolean }) => {
      const { error } = await supabase
        .from("qa_processes")
        .update({ is_export_allowed: value })
        .eq("id", processId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa-processes"] });
      toast.success("Export permission updated!");
    },
    onError: (error: any) => {
      toast.error(error.message);
    },
  });

  const columns = [
    { key: "code", header: "Code" },
    { key: "name", header: "Process Name" },
    {
      key: "production_departments.name",
      header: "Department",
      render: (row: any) => row.production_departments?.name || "-",
    },
    { key: "sequence_order", header: "Order" },
    ...(hasRole('super_admin') ? [{
      key: "is_export_allowed",
      header: "Export Allowed",
      render: (row: any) => (
        <Switch
          checked={row.is_export_allowed ?? false}
          onCheckedChange={(checked) => toggleExportMutation.mutate({ processId: row.id, value: checked })}
        />
      ),
    }] : []),
    {
      key: "is_active",
      header: "Status",
      render: (row: any) => (
        <StatusBadge status={row.is_active ? "active" : "inactive"} />
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => handleEdit(row)} title="Edit Process">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => openParametersDialog(row)} title="Manage Parameters">
            <Settings2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(`/qa/process-instructions?process=${row.id}`)} title="View Instructions">
            <BookOpen className="h-4 w-4 text-blue-500" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => navigate(`/qa/process-standards?process=${row.id}`)} title="View Standards">
            <Shield className="h-4 w-4 text-purple-500" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => handleDelete(row)} title="Delete Process">
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
          title="Process Master"
          description="Manage QA inspection processes and their parameters"
        >
          <Button onClick={() => { resetForm(); setShowDialog(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Process
          </Button>
        </PageHeader>

        <DataTable
          columns={columns}
          data={processes}
          emptyMessage="No processes found. Add your first QA process."
          className="overflow-x-auto"
        />

        {/* Process Dialog */}
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {selectedProcess ? "Edit Process" : "Add New Process"}
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Code *</Label>
                  <Input
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    placeholder="e.g., DRAW-01"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sequence Order</Label>
                  <Input
                    type="number"
                    value={formData.sequence_order}
                    onChange={(e) => setFormData({ ...formData, sequence_order: parseInt(e.target.value) })}
                    min={1}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Process Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Drawing Inspection"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Department</Label>
                <Select
                  value={formData.department_id}
                  onValueChange={(v) => setFormData({ ...formData, department_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Process description..."
                  rows={3}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-3">
                <div className="space-y-1">
                  <Label>Requires Inspection Tag</Label>
                  <p className="text-sm text-muted-foreground">
                    Enable tracking number and QR tag for inspections of this process.
                  </p>
                </div>
                <Switch
                  checked={formData.requires_inspection_tag}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, requires_inspection_tag: checked })
                  }
                />
              </div>

              {hasRole("super_admin") && (
                <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-3">
                  <div className="space-y-1">
                    <Label>Allow Export</Label>
                    <p className="text-sm text-muted-foreground">
                      Only selected processes can be exported from Process Inspections.
                    </p>
                  </div>
                  <Switch
                    checked={formData.is_export_allowed}
                    onCheckedChange={(checked) =>
                      setFormData({ ...formData, is_export_allowed: checked })
                    }
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setShowDialog(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={processMutation.isPending}>
                  {processMutation.isPending ? "Saving..." : "Save"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Parameters Dialog */}
        <Dialog open={showParametersDialog} onOpenChange={(open) => {
          setShowParametersDialog(open);
          if (open && processParameters.length > 0) {
            setParameters(processParameters as ProcessParameter[]);
          } else if (!open) {
            setParameters([]);
          }
        }}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                Manage Parameters - {selectedProcess?.name}
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {parameters.map((param, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 p-3 bg-muted/50 rounded-lg items-end">
                  <div className="col-span-3 space-y-1">
                    <Label className="text-xs">Parameter Name</Label>
                    <Input
                      value={param.parameter_name}
                      onChange={(e) => updateParameter(index, "parameter_name", e.target.value)}
                      placeholder="e.g., Temperature"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Type</Label>
                    <Select
                      value={param.parameter_type}
                      onValueChange={(v) => updateParameter(index, "parameter_type", v)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Text</SelectItem>
                        <SelectItem value="number">Number</SelectItem>
                        <SelectItem value="boolean">OK/Not Good</SelectItem>
                        <SelectItem value="select">Dropdown</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Unit</Label>
                    <Input
                      value={param.unit}
                      onChange={(e) => updateParameter(index, "unit", e.target.value)}
                      placeholder="e.g., °C"
                    />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <Label className="text-xs">Min</Label>
                    <Input
                      type="number"
                      value={param.min_value ?? ""}
                      onChange={(e) => updateParameter(index, "min_value", e.target.value ? parseFloat(e.target.value) : null)}
                    />
                  </div>
                  <div className="col-span-1 space-y-1">
                    <Label className="text-xs">Max</Label>
                    <Input
                      type="number"
                      value={param.max_value ?? ""}
                      onChange={(e) => updateParameter(index, "max_value", e.target.value ? parseFloat(e.target.value) : null)}
                    />
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <Switch
                      checked={param.is_required}
                      onCheckedChange={(checked) => updateParameter(index, "is_required", checked)}
                    />
                    <Label className="text-xs">Required</Label>
                  </div>
                  <div className="col-span-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeParameter(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" onClick={addParameter} className="w-full">
                <Plus className="h-4 w-4 mr-2" />
                Add Parameter
              </Button>

              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button type="button" variant="outline" onClick={() => setShowParametersDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={saveParameters} disabled={parametersMutation.isPending}>
                  {parametersMutation.isPending ? "Saving..." : "Save Parameters"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Process</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete "{processToDelete?.name}"? This will also delete all associated parameters. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </ERPLayout>
  );
}
