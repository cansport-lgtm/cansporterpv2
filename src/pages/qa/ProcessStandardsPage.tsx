import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Pencil, Trash2, Shield } from "lucide-react";
import { toast } from "sonner";

const STANDARD_TYPES = [
  { value: "specification", label: "Specification" },
  { value: "sop", label: "SOP" },
  { value: "tolerance", label: "Tolerance" },
  { value: "acceptance_criteria", label: "Acceptance Criteria" },
];

interface Standard {
  id: string;
  process_id: string;
  standard_title: string;
  standard_description: string | null;
  standard_type: string | null;
  target_value: string | null;
  tolerance_range: string | null;
  is_active: boolean;
  created_at: string;
}

export default function ProcessStandardsPage() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("super_admin");
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preselectedProcess = searchParams.get("process") || "";

  const [selectedDepartment, setSelectedDepartment] = useState<string>("all");
  const [selectedProcess, setSelectedProcess] = useState<string>(preselectedProcess);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingStandard, setEditingStandard] = useState<Standard | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Standard | null>(null);

  const [formData, setFormData] = useState({
    standard_title: "",
    standard_description: "",
    standard_type: "specification",
    target_value: "",
    tolerance_range: "",
  });

  // Fetch departments
  const { data: departments = [] } = useQuery({
    queryKey: ["departments_for_standards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("production_departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch processes filtered by department
  const { data: processes = [] } = useQuery({
    queryKey: ["processes_for_standards", selectedDepartment],
    queryFn: async () => {
      let query = supabase
        .from("qa_processes")
        .select("id, name, code, department_id")
        .eq("is_active", true)
        .order("sequence_order");

      if (selectedDepartment !== "all") {
        query = query.eq("department_id", selectedDepartment);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  // Auto-select process from URL param
  useEffect(() => {
    if (preselectedProcess && processes.length > 0) {
      const found = processes.find((p: any) => p.id === preselectedProcess);
      if (found) {
        setSelectedProcess(found.id);
        if (found.department_id) {
          setSelectedDepartment(found.department_id);
        }
      }
    }
  }, [preselectedProcess, processes]);

  // Fetch standards for selected process
  const { data: standards = [], isLoading } = useQuery({
    queryKey: ["qa_process_standards", selectedProcess],
    queryFn: async () => {
      if (!selectedProcess) return [];
      const { data, error } = await supabase
        .from("qa_process_standards")
        .select("*")
        .eq("process_id", selectedProcess)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as Standard[];
    },
    enabled: !!selectedProcess,
  });

  // Create/Update mutation
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editingStandard) {
        const { error } = await supabase
          .from("qa_process_standards")
          .update(data)
          .eq("id", editingStandard.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("qa_process_standards")
          .insert({ ...data, process_id: selectedProcess });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa_process_standards"] });
      toast.success(editingStandard ? "Standard updated" : "Standard added");
      closeDialog();
    },
    onError: (err: any) => toast.error(err.message),
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("qa_process_standards")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["qa_process_standards"] });
      toast.success("Standard deleted");
      setDeleteConfirm(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openAdd = () => {
    setEditingStandard(null);
    setFormData({
      standard_title: "",
      standard_description: "",
      standard_type: "specification",
      target_value: "",
      tolerance_range: "",
    });
    setDialogOpen(true);
  };

  const openEdit = (s: Standard) => {
    setEditingStandard(s);
    setFormData({
      standard_title: s.standard_title,
      standard_description: s.standard_description || "",
      standard_type: s.standard_type || "specification",
      target_value: s.target_value || "",
      tolerance_range: s.tolerance_range || "",
    });
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingStandard(null);
  };

  const handleSave = () => {
    if (!formData.standard_title.trim()) {
      toast.error("Standard title is required");
      return;
    }
    saveMutation.mutate({
      standard_title: formData.standard_title.trim(),
      standard_description: formData.standard_description.trim() || null,
      standard_type: formData.standard_type,
      target_value: formData.target_value.trim() || null,
      tolerance_range: formData.tolerance_range.trim() || null,
    });
  };

  const getTypeBadge = (type: string | null) => {
    const colors: Record<string, string> = {
      specification: "bg-blue-100 text-blue-800",
      sop: "bg-green-100 text-green-800",
      tolerance: "bg-orange-100 text-orange-800",
      acceptance_criteria: "bg-purple-100 text-purple-800",
    };
    return (
      <Badge className={colors[type || "specification"] || "bg-muted text-muted-foreground"}>
        {STANDARD_TYPES.find((t) => t.value === type)?.label || type}
      </Badge>
    );
  };

  if (!isSuperAdmin) {
    return (
      <ERPLayout>
        <div className="flex items-center justify-center h-64">
          <p className="text-muted-foreground">Access restricted to Super Admin only.</p>
        </div>
      </ERPLayout>
    );
  }

  const selectedProcessData = processes.find((p: any) => p.id === selectedProcess);

  return (
    <ERPLayout>
      <PageHeader
        title="Process Standards"
        description="Define quality standards, tolerances, and acceptance criteria for each process"
      />

      <div className="space-y-4">
        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label>Department</Label>
                <Select value={selectedDepartment} onValueChange={(v) => { setSelectedDepartment(v); setSelectedProcess(""); }}>
                  <SelectTrigger><SelectValue placeholder="All Departments" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Departments</SelectItem>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Process</Label>
                <Select value={selectedProcess} onValueChange={setSelectedProcess}>
                  <SelectTrigger><SelectValue placeholder="Select Process" /></SelectTrigger>
                  <SelectContent>
                    {processes.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                {selectedProcess && (
                  <Button onClick={openAdd}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Standard
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Standards List */}
        {selectedProcess ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Standards for {selectedProcessData?.code} - {selectedProcessData?.name}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <p className="text-muted-foreground text-center py-8">Loading...</p>
              ) : standards.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No standards defined yet. Click "Add Standard" to create one.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Target Value</TableHead>
                      <TableHead>Tolerance</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {standards.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.standard_title}</TableCell>
                        <TableCell>{getTypeBadge(s.standard_type)}</TableCell>
                        <TableCell>{s.target_value || "-"}</TableCell>
                        <TableCell>{s.tolerance_range || "-"}</TableCell>
                        <TableCell className="max-w-xs truncate">{s.standard_description || "-"}</TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(s)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm(s)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              Select a process to view and manage its quality standards.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingStandard ? "Edit Standard" : "Add Standard"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Title *</Label>
              <Input
                value={formData.standard_title}
                onChange={(e) => setFormData({ ...formData, standard_title: e.target.value })}
                placeholder="e.g. Acceptable Color Range"
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={formData.standard_type} onValueChange={(v) => setFormData({ ...formData, standard_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STANDARD_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Target Value</Label>
              <Input
                value={formData.target_value}
                onChange={(e) => setFormData({ ...formData, target_value: e.target.value })}
                placeholder="e.g. 25°C or 10-15mm"
              />
            </div>
            <div>
              <Label>Tolerance Range</Label>
              <Input
                value={formData.tolerance_range}
                onChange={(e) => setFormData({ ...formData, tolerance_range: e.target.value })}
                placeholder="e.g. ±0.5mm"
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.standard_description}
                onChange={(e) => setFormData({ ...formData, standard_description: e.target.value })}
                placeholder="Detailed standard criteria..."
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={closeDialog}>Cancel</Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Standard?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deleteConfirm?.standard_title}".
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
