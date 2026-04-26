import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ERPLayout } from "@/components/layout/ERPLayout";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Users,
  UserPlus,
  GraduationCap,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  CheckCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface SkilledLabourEntry {
  id: string;
  department_id: string | null;
  process_id: string | null;
  process_name: string;
  available_workers: number;
  required_workers: number;
  to_train: number;
  to_hire: number;
  output_per_worker_per_day: number;
  output_unit: string | null;
  remarks: string | null;
  is_active: boolean | null;
  production_departments?: { name: string } | null;
  qa_processes?: { name: string } | null;
}

interface FormData {
  department_id: string;
  process_id: string;
  process_name: string;
  available_workers: number;
  required_workers: number;
  to_train: number;
  to_hire: number;
  output_per_worker_per_day: number;
  output_unit: string;
  remarks: string;
}

const defaultForm: FormData = {
  department_id: "",
  process_id: "",
  process_name: "",
  available_workers: 0,
  required_workers: 0,
  to_train: 0,
  to_hire: 0,
  output_per_worker_per_day: 0,
  output_unit: "dozens",
  remarks: "",
};

export default function SkilledLabourPlanningPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(defaultForm);
  const [filterDepartment, setFilterDepartment] = useState<string>("all");

  // Fetch departments
  const { data: departments } = useQuery({
    queryKey: ["production-departments"],
    queryFn: async () => {
      const { data } = await supabase
        .from("production_departments")
        .select("*")
        .eq("is_active", true)
        .order("sequence_order");
      return data || [];
    },
  });

  // Fetch processes
  const { data: processes } = useQuery({
    queryKey: ["qa-processes"],
    queryFn: async () => {
      const { data } = await supabase
        .from("qa_processes")
        .select("*")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  // Fetch skilled labour data
  const { data: labourData, isLoading } = useQuery({
    queryKey: ["skilled-labour-planning"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("skilled_labour_planning")
        .select("*, production_departments(name), qa_processes(name)")
        .eq("is_active", true)
        .order("created_at");
      if (error) throw error;
      return (data || []) as SkilledLabourEntry[];
    },
  });

  // Filter by department
  const filteredData = useMemo(() => {
    if (!labourData) return [];
    if (filterDepartment === "all") return labourData;
    return labourData.filter((d) => d.department_id === filterDepartment);
  }, [labourData, filterDepartment]);

  // Group by department
  const groupedByDept = useMemo(() => {
    const grouped: Record<string, { name: string; entries: SkilledLabourEntry[] }> = {};
    filteredData.forEach((entry) => {
      const deptId = entry.department_id || "unassigned";
      const deptName = entry.production_departments?.name || "Unassigned";
      if (!grouped[deptId]) grouped[deptId] = { name: deptName, entries: [] };
      grouped[deptId].entries.push(entry);
    });
    return grouped;
  }, [filteredData]);

  // Summary metrics
  const summary = useMemo(() => {
    const data = filteredData;
    const totalAvailable = data.reduce((s, d) => s + d.available_workers, 0);
    const totalRequired = data.reduce((s, d) => s + d.required_workers, 0);
    const totalToTrain = data.reduce((s, d) => s + d.to_train, 0);
    const totalToHire = data.reduce((s, d) => s + d.to_hire, 0);
    const fulfillment = totalRequired > 0 ? (totalAvailable / totalRequired) * 100 : 0;
    return { totalAvailable, totalRequired, totalToTrain, totalToHire, fulfillment };
  }, [filteredData]);

  // Filtered processes based on selected department
  const filteredProcesses = useMemo(() => {
    if (!processes || !formData.department_id) return processes || [];
    return processes.filter(
      (p: any) => !p.department_id || p.department_id === formData.department_id
    );
  }, [processes, formData.department_id]);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const payload: any = {
        department_id: data.department_id || null,
        process_id: data.process_id || null,
        process_name: data.process_name,
        available_workers: data.available_workers,
        required_workers: data.required_workers,
        to_train: data.to_train,
        to_hire: data.to_hire,
        output_per_worker_per_day: data.output_per_worker_per_day,
        output_unit: data.output_unit,
        remarks: data.remarks || null,
      };
      if (editingId) {
        const { error } = await supabase
          .from("skilled_labour_planning")
          .update(payload)
          .eq("id", editingId);
        if (error) throw error;
      } else {
        payload.created_by = user?.id || null;
        const { error } = await supabase
          .from("skilled_labour_planning")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skilled-labour-planning"] });
      toast.success(editingId ? "Updated successfully" : "Added successfully");
      setIsDialogOpen(false);
      setEditingId(null);
      setFormData(defaultForm);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("skilled_labour_planning")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skilled-labour-planning"] });
      toast.success("Deleted successfully");
      setDeleteId(null);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const openEdit = (entry: SkilledLabourEntry) => {
    setEditingId(entry.id);
    setFormData({
      department_id: entry.department_id || "",
      process_id: entry.process_id || "",
      process_name: entry.process_name,
      available_workers: entry.available_workers,
      required_workers: entry.required_workers,
      to_train: entry.to_train,
      to_hire: entry.to_hire,
      output_per_worker_per_day: entry.output_per_worker_per_day,
      output_unit: entry.output_unit || "dozens",
      remarks: entry.remarks || "",
    });
    setIsDialogOpen(true);
  };

  const handleProcessChange = (processId: string) => {
    const process = processes?.find((p: any) => p.id === processId);
    setFormData((prev) => ({
      ...prev,
      process_id: processId,
      process_name: process?.name || "",
    }));
  };

  const gap = (entry: SkilledLabourEntry) => entry.required_workers - entry.available_workers;

  return (
    <ERPLayout>
      <div className="space-y-6">
        <PageHeader
          title="Skilled Labour Planning"
          description="Track available & required skilled workers per process, training/hiring needs, and production capacity"
        />

        {/* Summary Cards */}
        <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available Workers</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{summary.totalAvailable}</div>
              <p className="text-xs text-muted-foreground">of {summary.totalRequired} required</p>
              <Progress value={Math.min(summary.fulfillment, 100)} className="mt-2" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">To Train</CardTitle>
              <GraduationCap className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{summary.totalToTrain}</div>
              <p className="text-xs text-muted-foreground">Workers need training</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">To Hire</CardTitle>
              <UserPlus className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{summary.totalToHire}</div>
              <p className="text-xs text-muted-foreground">New hires needed</p>
            </CardContent>
          </Card>
        </div>

        {/* Department-wise Daily Capacity */}
        {labourData && labourData.length > 0 && (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {Object.entries(
              labourData.reduce<Record<string, { name: string; current: number; potential: number; unit: string }>>((acc, entry) => {
                const deptId = entry.department_id || "unassigned";
                const deptName = entry.production_departments?.name || "Unassigned";
                if (!acc[deptId]) acc[deptId] = { name: deptName, current: 0, potential: 0, unit: entry.output_unit || "units" };
                acc[deptId].current += entry.available_workers * entry.output_per_worker_per_day;
                acc[deptId].potential += entry.required_workers * entry.output_per_worker_per_day;
                return acc;
              }, {})
            ).map(([deptId, dept]) => {
              const pct = dept.potential > 0 ? (dept.current / dept.potential) * 100 : 0;
              return (
                <Card key={deptId} className="border-l-4 border-l-primary">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium truncate">{dept.name}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-2xl font-bold">{dept.current.toLocaleString()}</div>
                    <p className="text-xs text-muted-foreground">
                      of {dept.potential.toLocaleString()} potential ({dept.unit}/day)
                    </p>
                    <Progress value={Math.min(pct, 100)} className="h-2" />
                    <p className="text-xs font-medium text-right">{pct.toFixed(0)}%</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Filters & Actions */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Label className="whitespace-nowrap">Department:</Label>
            <Select value={filterDepartment} onValueChange={setFilterDepartment}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments?.map((dept: any) => (
                  <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => { setEditingId(null); setFormData(defaultForm); setIsDialogOpen(true); }}>
            <Plus className="h-4 w-4 mr-2" />
            Add Process
          </Button>
        </div>

        {/* Department-wise Tables */}
        {isLoading ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">Loading...</CardContent></Card>
        ) : Object.keys(groupedByDept).length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">No data configured. Click "Add Process" to get started.</CardContent></Card>
        ) : (
          Object.entries(groupedByDept).map(([deptId, { name, entries }]) => {
            const deptAvailable = entries.reduce((s, e) => s + e.available_workers, 0);
            const deptRequired = entries.reduce((s, e) => s + e.required_workers, 0);
            const deptCapacity = entries.reduce((s, e) => s + e.available_workers * e.output_per_worker_per_day, 0);
            const deptFull = entries.reduce((s, e) => s + e.required_workers * e.output_per_worker_per_day, 0);

            return (
              <Card key={deptId}>
                <CardHeader>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <CardTitle className="text-lg">{name}</CardTitle>
                    <div className="flex items-center gap-4 text-sm">
                      <span>Workers: <strong>{deptAvailable}/{deptRequired}</strong></span>
                      <span>Capacity: <strong>{deptCapacity.toLocaleString()}</strong> / {deptFull.toLocaleString()}</span>
                      <Badge variant={deptAvailable >= deptRequired ? "default" : "destructive"}>
                        {deptAvailable >= deptRequired ? "Adequate" : "Shortage"}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Process</TableHead>
                          <TableHead className="text-center">Available</TableHead>
                          <TableHead className="text-center">Required</TableHead>
                          <TableHead className="text-center">Gap</TableHead>
                          <TableHead className="text-center">To Train</TableHead>
                          <TableHead className="text-center">To Hire</TableHead>
                          <TableHead className="text-center">Output/Worker/Day</TableHead>
                          <TableHead className="text-center">Current Capacity/Day</TableHead>
                          <TableHead className="text-center">Status</TableHead>
                          <TableHead>Remarks</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {entries.map((entry) => {
                          const g = gap(entry);
                          const currentCap = entry.available_workers * entry.output_per_worker_per_day;
                          return (
                            <TableRow key={entry.id}>
                              <TableCell className="font-medium">{entry.process_name}</TableCell>
                              <TableCell className="text-center">{entry.available_workers}</TableCell>
                              <TableCell className="text-center">{entry.required_workers}</TableCell>
                              <TableCell className="text-center">
                                <span className={g > 0 ? "text-destructive font-semibold" : "text-green-600 font-semibold"}>
                                  {g > 0 ? `-${g}` : g === 0 ? "0" : `+${Math.abs(g)}`}
                                </span>
                              </TableCell>
                              <TableCell className="text-center">
                                {entry.to_train > 0 ? (
                                  <Badge variant="secondary">{entry.to_train}</Badge>
                                ) : "0"}
                              </TableCell>
                              <TableCell className="text-center">
                                {entry.to_hire > 0 ? (
                                  <Badge variant="destructive">{entry.to_hire}</Badge>
                                ) : "0"}
                              </TableCell>
                              <TableCell className="text-center">
                                {entry.output_per_worker_per_day} {entry.output_unit}
                              </TableCell>
                              <TableCell className="text-center font-semibold">
                                {currentCap.toLocaleString()} {entry.output_unit}
                              </TableCell>
                              <TableCell className="text-center">
                                {g > 0 ? (
                                  <AlertTriangle className="h-4 w-4 text-destructive inline" />
                                ) : (
                                  <CheckCircle className="h-4 w-4 text-green-600 inline" />
                                )}
                              </TableCell>
                              <TableCell className="max-w-[150px] truncate text-sm text-muted-foreground">
                                {entry.remarks || "-"}
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex justify-end gap-1">
                                  <Button variant="ghost" size="icon" onClick={() => openEdit(entry)}>
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => setDeleteId(entry.id)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Add/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit" : "Add"} Process Labour Plan</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Department *</Label>
                <Select value={formData.department_id} onValueChange={(v) => setFormData((p) => ({ ...p, department_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select Department" /></SelectTrigger>
                  <SelectContent>
                    {departments?.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Process *</Label>
                <Select value={formData.process_id} onValueChange={handleProcessChange}>
                  <SelectTrigger><SelectValue placeholder="Select Process" /></SelectTrigger>
                  <SelectContent>
                    {filteredProcesses?.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Available Workers</Label>
                <Input type="number" min={0} value={formData.available_workers} onChange={(e) => setFormData((p) => ({ ...p, available_workers: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Required Workers</Label>
                <Input type="number" min={0} value={formData.required_workers} onChange={(e) => setFormData((p) => ({ ...p, required_workers: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>To Train</Label>
                <Input type="number" min={0} value={formData.to_train} onChange={(e) => setFormData((p) => ({ ...p, to_train: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>To Hire</Label>
                <Input type="number" min={0} value={formData.to_hire} onChange={(e) => setFormData((p) => ({ ...p, to_hire: Number(e.target.value) }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Output/Worker/Day</Label>
                <Input type="number" min={0} step="0.01" value={formData.output_per_worker_per_day} onChange={(e) => setFormData((p) => ({ ...p, output_per_worker_per_day: Number(e.target.value) }))} />
              </div>
              <div>
                <Label>Unit</Label>
                <Select value={formData.output_unit} onValueChange={(v) => setFormData((p) => ({ ...p, output_unit: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dozens">Dozens</SelectItem>
                    <SelectItem value="pieces">Pieces</SelectItem>
                    <SelectItem value="kg">KG</SelectItem>
                    <SelectItem value="bags">Bags</SelectItem>
                    <SelectItem value="sheets">Sheets</SelectItem>
                    <SelectItem value="gaddi">Gaddi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Remarks</Label>
              <Textarea value={formData.remarks} onChange={(e) => setFormData((p) => ({ ...p, remarks: e.target.value }))} placeholder="Optional notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!formData.department_id || !formData.process_name) {
                  toast.error("Department and Process are required");
                  return;
                }
                saveMutation.mutate(formData);
              }}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : editingId ? "Update" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This will remove the process from skilled labour planning.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ERPLayout>
  );
}
